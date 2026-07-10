import { expect, it, mock } from 'bun:test';
import type { MintResult } from '@maelstrom-co/realtime-server';

// The route module builds its minter singleton at import time via
// createOpenAIMinter — fake the module boundary so each test controls the
// minter's result without touching real OpenAI credentials or network.
let mintResult: MintResult = { ok: false, error: { reason: 'invalid-request' } };
let lastMintInput: unknown;

mock.module('@maelstrom-co/realtime-server', () => ({
  createOpenAIMinter: () => (input: unknown) => {
    lastMintInput = input;
    return Promise.resolve(mintResult);
  },
}));

const { handleRealtimeTokenRequest } = await import('./realtime-token.js');

it('rejects a non-POST method with a 400 and never calls the minter', async () => {
  lastMintInput = undefined;
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', { method: 'GET' }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(lastMintInput).toBeUndefined();
});

it('rejects a malformed JSON body with a 400 and never calls the minter', async () => {
  lastMintInput = undefined;
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', { method: 'POST', body: '{not valid json' }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect((body as { error: unknown }).error).toBe('Malformed request body');
  expect(lastMintInput).toBeUndefined();
});

it('passes the parsed body to the minter and returns its response on success', async () => {
  mintResult = {
    ok: true,
    value: { provider: 'openai', value: 'ek-xyz', expiresAt: 1712345678, model: 'gpt-realtime-2' },
  };
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body).toEqual(mintResult.value);
  expect(lastMintInput).toEqual({ provider: 'openai', sessionId: 'sess-1' });
});

const REASON_STATUS: Array<[MintResult, number]> = [
  [{ ok: false, error: { reason: 'invalid-request' } }, 400],
  [{ ok: false, error: { reason: 'unsupported-provider' } }, 400],
  [{ ok: false, error: { reason: 'missing-api-key' } }, 500],
  [{ ok: false, error: { reason: 'upstream-failure' } }, 502],
];

for (const [result, status] of REASON_STATUS) {
  it(`maps mint failure reason "${result.ok ? '' : result.error.reason}" to status ${status}`, async () => {
    mintResult = result;
    const res = await handleRealtimeTokenRequest(
      new Request('http://x/api/realtime-token', {
        method: 'POST',
        body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(status);
    expect(typeof (body as { error: unknown }).error).toBe('string');
  });
}

it('passes the upstream status through on an upstream-failure result', async () => {
  mintResult = { ok: false, error: { reason: 'upstream-failure', upstreamStatus: 401 } };
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(502);
  expect((body as { upstreamStatus: unknown }).upstreamStatus).toBe(401);
});
