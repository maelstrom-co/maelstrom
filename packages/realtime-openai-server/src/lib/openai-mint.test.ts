import { expect, it } from 'bun:test';

import { isErr, isOk } from '@maelstrom-co/protocol';
import {
  MINT_FAILURE_REASONS,
  type MintFailureReason,
  mintFailureHttpStatus,
  UnixSecondsSchema,
} from '@maelstrom-co/realtime-protocol';

import { createOpenAIMinter } from './openai-mint.js';

it('mints an ephemeral secret without leaking the api key', async () => {
  let sentAuth = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentAuth = (init.headers as Record<string, string>).Authorization;
    return new Response(
      JSON.stringify({
        value: 'ek-xyz',
        expires_at: 1712345678,
        session: { id: 's' },
      }),
      { status: 200 },
    );
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(isOk(result)).toBe(true);
  if (!isOk(result)) throw new Error('expected ok result');
  expect(result.value.value).toBe('ek-xyz');
  expect(result.value.expiresAt).toBe(UnixSecondsSchema.parse(1712345678));
  expect(result.value.model).toBe('gpt-realtime-1.5');
  expect(sentAuth).toBe('Bearer sk-secret');
  expect(JSON.stringify(result)).not.toContain('sk-secret');
});

it('reports upstream-failure with the upstream status when upstream rejects the request', async () => {
  const fakeFetch = async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ error: { message: 'bad key' } }), {
      status: 401,
    });
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({
    reason: 'upstream-failure',
    upstreamStatus: 401,
  });
  expect(JSON.stringify(result)).not.toContain('sk-secret');
});

it('reports upstream-failure when upstream returns 200 with a null body, instead of throwing', async () => {
  const fakeFetch = async (_url: string, _init: RequestInit) =>
    new Response('null', { status: 200 });
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({
    reason: 'upstream-failure',
    upstreamStatus: 200,
  });
});

it('rejects a provider other than openai with invalid-request and never calls upstream fetch', async () => {
  // Open-world token model: there is no shared provider enum. The OpenAI mint
  // request is `provider: 'openai'` (a literal), so a non-openai provider is
  // simply not a valid OpenAI request — `invalid-request`, not a distinct
  // `unsupported-provider` (which the shared vocabulary keeps for a minter that
  // does discriminate a known-but-unhandled provider).
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'google', sessionId: 'sess-1' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({ reason: 'invalid-request' });
  expect(fetchCalled).toBe(false);
});

it('honors a model override in the request, in both the upstream call and the response', async () => {
  let sentBody = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentBody = init.body as string;
    return new Response(
      JSON.stringify({
        value: 'ek-xyz',
        expires_at: 1712345678,
        session: { id: 's' },
      }),
      { status: 200 },
    );
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({
    provider: 'openai',
    sessionId: 'sess-1',
    model: 'gpt-realtime-override',
  });
  expect(JSON.parse(sentBody).session.model).toBe('gpt-realtime-override');
  expect(isOk(result)).toBe(true);
  if (!isOk(result)) throw new Error('expected ok result');
  expect(result.value.model).toBe('gpt-realtime-override');
});

it('falls back to the server-configured model when no override is provided', async () => {
  let sentBody = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentBody = init.body as string;
    return new Response(
      JSON.stringify({
        value: 'ek-xyz',
        expires_at: 1712345678,
        session: { id: 's' },
      }),
      { status: 200 },
    );
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(JSON.parse(sentBody).session.model).toBe('gpt-realtime-1.5');
  expect(isOk(result)).toBe(true);
  if (!isOk(result)) throw new Error('expected ok result');
  expect(result.value.model).toBe('gpt-realtime-1.5');
});

it('reports upstream-failure with no upstream status when the upstream fetch throws', async () => {
  const fakeFetch = async (): Promise<Response> => {
    throw new Error('network down');
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({ reason: 'upstream-failure' });
  expect(JSON.stringify(result)).not.toContain('sk-secret');
});

it('rejects a structurally invalid handshake with invalid-request and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({ reason: 'invalid-request' });
  expect(fetchCalled).toBe(false);
});

it('rejects a handshake with a wrong-typed provider with invalid-request and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 123, sessionId: 'sess-1' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({ reason: 'invalid-request' });
  expect(fetchCalled).toBe(false);
});

it('rejects non-object input with invalid-request and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint('not an object');
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({ reason: 'invalid-request' });
  expect(fetchCalled).toBe(false);
});

it('returns missing-api-key and never calls upstream fetch when the minter holds no api key', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const mint = createOpenAIMinter({
    apiKey: '',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('expected err result');
  expect(result.error).toEqual({ reason: 'missing-api-key' });
  expect(fetchCalled).toBe(false);
});

it('maps every MintFailureReason to its suggested HTTP status', () => {
  const expected: Record<MintFailureReason, number> = {
    'invalid-request': 400,
    'unsupported-provider': 400,
    'missing-api-key': 500,
    'invalid-config': 500,
    'upstream-failure': 502,
  };

  // The Record type alone would not catch a dropped reason here: nx runs
  // typecheck against tsconfig.lib.json, which excludes spec files, so no
  // CI job ever compiles this one. Assert exhaustiveness at runtime instead,
  // against the array the reason union is derived from.
  expect(Object.keys(expected).sort()).toEqual(
    [...MINT_FAILURE_REASONS].sort(),
  );

  for (const [reason, status] of Object.entries(expected) as Array<
    [MintFailureReason, number]
  >) {
    expect(mintFailureHttpStatus(reason)).toBe(status);
  }
});
