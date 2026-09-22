import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { isErr, isOk } from '@maelstrom-co/protocol';

// Capture the grant passed to AccessToken so the test can assert the token is
// scoped to the requested room + identity.
let lastIdentity: string | undefined;
let lastTtl: string | number | undefined;
let lastGrant: Record<string, unknown> | undefined;
const sdk = await import('livekit-server-sdk');
const RealAccessToken = sdk.AccessToken;
const RealTokenVerifier = sdk.TokenVerifier;
let lastRoomConfig: InstanceType<typeof sdk.RoomConfiguration> | undefined;
let signRealToken = false;

mock.module('livekit-server-sdk', () => ({
  RoomConfiguration: sdk.RoomConfiguration,
  RoomAgentDispatch: sdk.RoomAgentDispatch,
  AccessToken: class {
    #identity: string | undefined;
    #token: InstanceType<typeof sdk.AccessToken>;
    constructor(
      _key: string,
      _secret: string,
      opts?: { identity?: string; ttl?: string | number },
    ) {
      this.#token = new RealAccessToken(_key, _secret, opts);
      this.#identity = opts?.identity;
      lastIdentity = opts?.identity;
      lastTtl = opts?.ttl;
    }
    addGrant(grant: Record<string, unknown>) {
      lastGrant = grant;
      this.#token.addGrant(grant);
    }
    set roomConfig(value: InstanceType<typeof sdk.RoomConfiguration>) {
      lastRoomConfig = value;
      this.#token.roomConfig = value;
    }
    async toJwt() {
      if (signRealToken) return this.#token.toJwt();
      return `jwt-for-${this.#identity}`;
    }
  },
}));

const { mintLiveKitToken } = await import('./livekit-mint.js');

// Assigning `undefined` back to `process.env.X` coerces to the literal string
// "undefined" rather than clearing the var — delete instead when the
// original was unset.
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('mintLiveKitToken', () => {
  const original = {
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET,
    url: process.env.LIVEKIT_URL,
    ttl: process.env.LIVEKIT_TOKEN_TTL,
  };

  beforeEach(() => {
    lastIdentity = undefined;
    lastTtl = undefined;
    lastGrant = undefined;
    lastRoomConfig = undefined;
    signRealToken = false;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    delete process.env.LIVEKIT_TOKEN_TTL;
  });

  afterEach(() => {
    restoreEnv('LIVEKIT_API_KEY', original.key);
    restoreEnv('LIVEKIT_API_SECRET', original.secret);
    restoreEnv('LIVEKIT_URL', original.url);
    restoreEnv('LIVEKIT_TOKEN_TTL', original.ttl);
  });

  test('returns a grant with a token, url, and future expiry', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(typeof result.value.token).toBe('string');
    expect(result.value.token.length).toBeGreaterThan(0);
    expect(result.value.url).toBe('ws://localhost:7880');
    // Default 15m TTL → expiry ~900s out.
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds);
    expect(result.value.expiresAt).toBeLessThanOrEqual(nowSeconds + 900 + 2);
  });

  test('creates a fresh trigger room rather than reusing the requested namespace', async () => {
    await mintLiveKitToken({ roomName: 'maelstrom-abc', trigger: true });
    const firstRoom = lastGrant?.room;
    expect(firstRoom).not.toBe('maelstrom-abc');
    await mintLiveKitToken({ roomName: 'maelstrom-abc', trigger: true });
    expect(lastGrant?.room).not.toBe(firstRoom);
  });

  test('signs matching explicit dispatch and ignores caller-chosen worker bindings', async () => {
    signRealToken = true;
    const result = await mintLiveKitToken({
      roomName: 'namespace',
      identity: 'browser',
      trigger: true,
      workerIdentity: 'attacker',
      expectedWorkerIdentity: 'attacker',
      metadata: 'attacker',
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const binding = result.value.trigger;
    expect(binding?.workerIdentity).toMatch(/^maelstrom-worker-/);
    expect(binding?.browserIdentity).toBe('browser');
    expect(binding?.expiresAt).toBe(result.value.expiresAt);
    const claims = await new RealTokenVerifier('devkey', 'secret').verify(
      result.value.token,
    );
    expect(claims.video?.room).toBe(binding?.roomName);
    expect(claims.roomConfig?.agents).toHaveLength(1);
    expect(claims.roomConfig?.agents[0]?.agentName).toBe(
      'maelstrom-trigger-v1',
    );
    expect(JSON.parse(claims.roomConfig?.agents[0]?.metadata ?? '{}')).toEqual(
      binding,
    );
    const again = await mintLiveKitToken({
      roomName: 'namespace',
      trigger: true,
    });
    if (!isOk(again)) throw new Error('second mint failed');
    expect(again.value.trigger?.workerIdentity).not.toBe(
      binding?.workerIdentity,
    );
  });

  test('normal grants omit trigger metadata and explicit dispatch', async () => {
    const result = await mintLiveKitToken({ roomName: 'normal' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(Object.keys(result.value).sort()).toEqual([
      'expiresAt',
      'token',
      'url',
    ]);
    expect(lastRoomConfig).toBeUndefined();
  });

  test('scopes the grant to the requested room and defaults identity to "user"', async () => {
    await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastIdentity).toBe('user');
    expect(lastGrant).toMatchObject({
      roomJoin: true,
      room: 'maelstrom-abc',
      canPublish: true,
      canSubscribe: true,
    });
  });

  test('honours a custom identity', async () => {
    await mintLiveKitToken({ roomName: 'maelstrom-abc', identity: 'agent' });
    expect(lastIdentity).toBe('agent');
  });

  test('trims a room name with surrounding whitespace', async () => {
    await mintLiveKitToken({ roomName: '  maelstrom-abc  ' });
    expect(lastGrant).toMatchObject({ room: 'maelstrom-abc' });
  });

  test('defaults the token ttl to 15m when LIVEKIT_TOKEN_TTL is unset', async () => {
    await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    // Passed as the numeric seconds count, not the raw '15m' string — a raw
    // string ttl goes verbatim to jose's parser, which requires a unit and
    // rejects a bare integer like the one this package's own docs recommend.
    expect(lastTtl).toBe(900);
  });

  test('honours LIVEKIT_TOKEN_TTL when set', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '2h';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastTtl).toBe(7200);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 2h → expiry ~7200s out.
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + 7000);
  });

  test('honours a bare-seconds LIVEKIT_TOKEN_TTL', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '90';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastTtl).toBe(90);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 90 → expiry ~90s out, not the 900s fallback.
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + 85);
    expect(result.value.expiresAt).toBeLessThanOrEqual(nowSeconds + 90 + 2);
  });

  test('mints successfully with a bare-integer LIVEKIT_TOKEN_TTL (livekit-server-sdk requires a numeric ttl to append units)', async () => {
    // A raw string ttl of '900' goes verbatim to jose's setExpirationTime,
    // whose grammar requires a unit and throws — the numeric ttlSeconds this
    // package already computed must be what's passed to AccessToken instead.
    process.env.LIVEKIT_TOKEN_TTL = '900';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(lastTtl).toBe(900);
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + 895);
    expect(result.value.expiresAt).toBeLessThanOrEqual(nowSeconds + 900 + 2);
  });

  test('accepts an oversized-but-parseable LIVEKIT_TOKEN_TTL', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '3650d';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    const expected = 3650 * 86400;
    expect(lastTtl).toBe(expected);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 3650d → ~315,360,000s out; operator's env, operator's choice.
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + expected - 5);
    expect(result.value.expiresAt).toBeLessThanOrEqual(
      nowSeconds + expected + 2,
    );
  });

  test('rejects a bare-integer LIVEKIT_TOKEN_TTL that overflows to Infinity', async () => {
    // A digit string this long parses to Infinity via Number(), which slips
    // past a bare `> 0` guard and would set expiresAt to Infinity — breaking
    // the fail-closed guarantee. Reject as invalid-config, sign nothing.
    process.env.LIVEKIT_TOKEN_TTL = '9'.repeat(400);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
    expect(lastTtl).toBeUndefined();
    expect(lastGrant).toBeUndefined();
  });

  test('rejects a <int><unit> LIVEKIT_TOKEN_TTL that overflows to Infinity', async () => {
    process.env.LIVEKIT_TOKEN_TTL = `${'9'.repeat(400)}s`;
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
    expect(lastTtl).toBeUndefined();
    expect(lastGrant).toBeUndefined();
  });

  test('rejects a <int><unit> LIVEKIT_TOKEN_TTL whose unit multiplication exceeds the safe-integer range', async () => {
    // Finite but unsafe: 1e12 days * 86400 overflows Number.MAX_SAFE_INTEGER,
    // so the computed expiry would silently lose precision.
    process.env.LIVEKIT_TOKEN_TTL = '999999999999d';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
    expect(lastTtl).toBeUndefined();
    expect(lastGrant).toBeUndefined();
  });

  test('rejects a "2 days" LIVEKIT_TOKEN_TTL the local parser cannot parse', async () => {
    // Headline bug: the SDK parses "2 days" (vercel/ms grammar) but the local
    // parser cannot, so the reported expiresAt would silently diverge from the
    // real JWT expiry. Fail closed instead of minting a mismatched grant.
    process.env.LIVEKIT_TOKEN_TTL = '2 days';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
  });

  test('rejects a "1w" LIVEKIT_TOKEN_TTL the local parser cannot parse', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '1w';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
  });

  test('rejects a non-numeric LIVEKIT_TOKEN_TTL', async () => {
    process.env.LIVEKIT_TOKEN_TTL = 'abc';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
  });

  test('rejects a zero-valued LIVEKIT_TOKEN_TTL', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '0';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
  });

  test('does not sign a token when the TTL is unparseable', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '2 days';
    await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    // The reject happens before any AccessToken is constructed.
    expect(lastTtl).toBeUndefined();
    expect(lastGrant).toBeUndefined();
  });

  test('returns invalid-config when LIVEKIT_URL is unset', async () => {
    delete process.env.LIVEKIT_URL;
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
    expect(lastGrant).toBeUndefined();
  });

  test('returns invalid-config when LIVEKIT_URL is an empty string', async () => {
    process.env.LIVEKIT_URL = '';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
  });

  test('returns invalid-config when LIVEKIT_URL has an http(s) scheme, not ws/wss', async () => {
    process.env.LIVEKIT_URL = 'https://example.com';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-config');
  });

  test('logs the actual grant-validation issues, not a fixed scheme-assumption string, when the grant fails schema validation', async () => {
    // The safeParse can fail on any of token/url/expiresAt, so the failure log
    // must surface the real zod issue rather than assert the scheme is at fault
    // — a fixed "must use ws:// or wss://" string misdirects an operator when
    // some other field is the problem.
    process.env.LIVEKIT_URL = 'https://example.com';
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error.reason).toBe('invalid-config');
      const logged = errorSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      // Surfaces the concrete zod issue (the failing `url` field).
      expect(logged).toContain('failed validation');
      expect(logged).toContain('url');
      // Not the old fixed string that presumes the scheme is always the fault.
      expect(logged).not.toContain('it must use the ws:// or wss:// scheme');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('mints successfully with a wss:// LIVEKIT_URL', async () => {
    process.env.LIVEKIT_URL = 'wss://example.com';
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.url).toBe('wss://example.com');
  });

  test('returns missing-api-key when credentials are absent', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('missing-api-key');
  });

  test('returns invalid-request for a missing room name', async () => {
    const result = await mintLiveKitToken({});
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-request');
  });

  test('returns invalid-request for a whitespace-only room name', async () => {
    const result = await mintLiveKitToken({ roomName: '   ' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.reason).toBe('invalid-request');
  });
});
