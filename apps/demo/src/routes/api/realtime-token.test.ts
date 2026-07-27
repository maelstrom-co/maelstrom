import type { UnixSeconds } from '@maelstrom-co/realtime';
import type {
  MintFailureReason,
  MintResult,
} from '@maelstrom-co/realtime-server';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Mirrors the default in realtime-token.ts; this branch has no shared constant.
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2';

// Regression test for the error-precedence bug: with no OPENAI_API_KEY
// configured, a malformed request body must still surface as a server
// misconfiguration (500), not a client error (400) — otherwise 5xx
// alerting never fires. This import must happen before `vi.doMock` below
// runs, so the route's minter singleton binds to the REAL createOpenAIMinter
// rather than the mock the rest of this file installs. An empty apiKey
// short-circuits before any upstream fetch, so this is network-safe.
process.env.OPENAI_API_KEY = '';
const { handleRealtimeTokenRequest: handleWithRealMinter } = await import(
  './realtime-token.js'
);

it('reports a 500 for a malformed body when no API key is configured (real minter)', async () => {
  const res = await handleWithRealMinter(
    new Request('http://x/api/realtime-token', {
      method: 'POST',
      body: '{not valid json',
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(500);
  expect((body as { error: unknown }).error).toBe('missing-api-key');
});

// The route module builds its minter singleton at import time via
// createOpenAIMinter — fake the module boundary so each remaining test
// controls the minter's result without touching real OpenAI credentials or
// network. Re-imported below under a distinct specifier so this picks up a
// fresh module instance bound to the mock, independent of the real-minter
// import above. `vi.doMock` (unlike `vi.mock`) is not hoisted, matching
// Bun's `mock.module` runtime-application semantics this test relies on.
let mintResult: MintResult = {
  ok: false,
  error: { reason: 'invalid-request' },
};
let lastMintInput: unknown;
let mintCallCount = 0;
let lastMinterOptions: { apiKey: string; model: string } | undefined;

const STATUS: Record<MintFailureReason, number> = {
  'invalid-request': 400,
  'unsupported-provider': 400,
  'missing-api-key': 500,
  'invalid-config': 500,
  'upstream-failure': 502,
};

vi.doMock('@maelstrom-co/realtime-server', () => ({
  createOpenAIMinter: (options: { apiKey: string; model: string }) => {
    lastMinterOptions = options;
    return (input: unknown) => {
      lastMintInput = input;
      mintCallCount += 1;
      return Promise.resolve(mintResult);
    };
  },
  mintFailureHttpStatus: (reason: MintFailureReason) => STATUS[reason],
}));

// Built at runtime (not a string literal) so tsc treats the specifier as
// opaque instead of statically resolving it — a literal `?mocked` suffix
// fails module resolution (TS2307) even though Bun resolves it fine at
// runtime. The `typeof import(...)` cast restores type-checking on the
// result.
const mockedRouteSpecifier = './realtime-token.js' + '?mocked';
const { handleRealtimeTokenRequest } = (await import(
  mockedRouteSpecifier
)) as typeof import('./realtime-token.js');

it('rejects a non-POST method with a 400 and never calls the minter', async () => {
  mintCallCount = 0;
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', { method: 'GET' }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(mintCallCount).toBe(0);
});

it('rejects a malformed JSON body with a 400 when a key is configured', async () => {
  // The route consults the minter with `undefined` to rule out server
  // misconfiguration before reporting the body itself as malformed — with a
  // configured key the minter reports invalid-request, not missing-api-key.
  mintResult = { ok: false, error: { reason: 'invalid-request' } };
  mintCallCount = 0;
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', {
      method: 'POST',
      body: '{not valid json',
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect((body as { error: unknown }).error).toBe('Malformed request body');
  expect(mintCallCount).toBe(1);
  expect(lastMintInput).toBeUndefined();
});

it('reports a 500 misconfiguration status for a malformed JSON body when the key is missing', async () => {
  mintResult = { ok: false, error: { reason: 'missing-api-key' } };
  mintCallCount = 0;
  const res = await handleRealtimeTokenRequest(
    new Request('http://x/api/realtime-token', {
      method: 'POST',
      body: '{not valid json',
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(500);
  expect((body as { error: unknown }).error).toBe('missing-api-key');
  expect(mintCallCount).toBe(1);
});

it('passes the parsed body to the minter and returns its response on success', async () => {
  mintResult = {
    ok: true,
    value: {
      provider: 'openai',
      value: 'ek-xyz',
      expiresAt: 1712345678 as UnixSeconds,
      model: 'gpt-realtime-2',
    },
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
  [{ ok: false, error: { reason: 'invalid-config' } }, 500],
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
  mintResult = {
    ok: false,
    error: { reason: 'upstream-failure', upstreamStatus: 401 },
  };
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

// Regression test: `.env.example` ships `OPENAI_REALTIME_MODEL=` (blank),
// and the README's documented onboarding path is `cp .env.example .env`. A
// bare `??` fallback only triggers on null/undefined, so a blank string
// would survive and reach the minter, which never validates it — OpenAI
// then rejects the mint and the route surfaces TOKEN_MINT_FAILED on the
// default setup. Each case re-imports the route module under a distinct
// specifier so the module-scoped `mint` singleton is rebuilt against the
// env value set immediately beforehand.
describe('OPENAI_REALTIME_MODEL env fallback', () => {
  const originalEnv = process.env.OPENAI_REALTIME_MODEL;

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENAI_REALTIME_MODEL;
    } else {
      process.env.OPENAI_REALTIME_MODEL = originalEnv;
    }
  });

  // Built at runtime (not a string literal), same as `mockedRouteSpecifier`
  // above, so tsc treats the specifier as opaque instead of statically
  // resolving it — a literal `?query` suffix fails module resolution
  // (TS2307) even though Bun/Vite resolve it fine at runtime.
  function freshRouteSpecifier(tag: string): string {
    return `./realtime-token.js?${tag}`;
  }

  it('falls back to DEFAULT_REALTIME_MODEL for a blank string', async () => {
    process.env.OPENAI_REALTIME_MODEL = '';
    await import(freshRouteSpecifier('model-blank'));
    expect(lastMinterOptions?.model).toBe(DEFAULT_REALTIME_MODEL);
  });

  it('falls back to DEFAULT_REALTIME_MODEL for a whitespace-only string', async () => {
    process.env.OPENAI_REALTIME_MODEL = '   ';
    await import(freshRouteSpecifier('model-whitespace'));
    expect(lastMinterOptions?.model).toBe(DEFAULT_REALTIME_MODEL);
  });

  it('uses the env value when it is a real, non-blank string', async () => {
    process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime-custom';
    await import(freshRouteSpecifier('model-real'));
    expect(lastMinterOptions?.model).toBe('gpt-realtime-custom');
  });

  it('falls back to DEFAULT_REALTIME_MODEL when unset', async () => {
    delete process.env.OPENAI_REALTIME_MODEL;
    await import(freshRouteSpecifier('model-unset'));
    expect(lastMinterOptions?.model).toBe(DEFAULT_REALTIME_MODEL);
  });
});
