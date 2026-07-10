import { expect, it } from 'bun:test';
import { createOpenAIMinter } from './openai-mint.js';

it('mints an ephemeral secret without leaking the api key', async () => {
  let sentAuth = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentAuth = (init.headers as Record<string, string>).Authorization;
    return new Response(
      JSON.stringify({ value: 'ek-xyz', expires_at: 1712345678, session: { id: 's' } }),
      { status: 200 },
    );
  };
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok result');
  expect(result.response.value).toBe('ek-xyz');
  expect(result.response.expiresAt).toBe(1712345678);
  expect(result.response.model).toBe('gpt-realtime-1.5');
  expect(sentAuth).toBe('Bearer sk-secret');
  expect(JSON.stringify(result)).not.toContain('sk-secret');
});

it('reports upstream-failure with the upstream status when upstream rejects the request', async () => {
  const fakeFetch = async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  const mint = createOpenAIMinter({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const result = await mint({ provider: 'openai', sessionId: 'sess-1' });
  expect(result).toEqual({ ok: false, reason: 'upstream-failure', upstreamStatus: 401 });
  expect(JSON.stringify(result)).not.toContain('sk-secret');
});

it('rejects a provider other than openai with unsupported-provider and never calls upstream fetch', async () => {
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
  expect(result).toEqual({ ok: false, reason: 'unsupported-provider' });
  expect(fetchCalled).toBe(false);
});

it('honors a model override in the request, in both the upstream call and the response', async () => {
  let sentBody = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentBody = init.body as string;
    return new Response(
      JSON.stringify({ value: 'ek-xyz', expires_at: 1712345678, session: { id: 's' } }),
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
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok result');
  expect(result.response.model).toBe('gpt-realtime-override');
});

it('falls back to the server-configured model when no override is provided', async () => {
  let sentBody = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentBody = init.body as string;
    return new Response(
      JSON.stringify({ value: 'ek-xyz', expires_at: 1712345678, session: { id: 's' } }),
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
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok result');
  expect(result.response.model).toBe('gpt-realtime-1.5');
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
  expect(result).toEqual({ ok: false, reason: 'upstream-failure' });
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
  expect(result).toEqual({ ok: false, reason: 'invalid-request' });
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
  expect(result).toEqual({ ok: false, reason: 'invalid-request' });
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
  expect(result).toEqual({ ok: false, reason: 'invalid-request' });
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
  expect(result).toEqual({ ok: false, reason: 'missing-api-key' });
  expect(fetchCalled).toBe(false);
});
