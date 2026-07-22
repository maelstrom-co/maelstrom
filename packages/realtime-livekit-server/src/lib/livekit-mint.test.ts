import { test, expect, mock, beforeEach, afterEach, describe } from 'bun:test';
import { isErr, isOk } from '@maelstrom-co/protocol';

// Capture the grant passed to AccessToken so the test can assert the token is
// scoped to the requested room + identity.
let lastIdentity: string | undefined;
let lastTtl: string | number | undefined;
let lastGrant: Record<string, unknown> | undefined;

mock.module('livekit-server-sdk', () => ({
  AccessToken: class {
    #identity: string | undefined;
    constructor(
      _key: string,
      _secret: string,
      opts?: { identity?: string; ttl?: string | number },
    ) {
      this.#identity = opts?.identity;
      lastIdentity = opts?.identity;
      lastTtl = opts?.ttl;
    }
    addGrant(grant: Record<string, unknown>) {
      lastGrant = grant;
    }
    async toJwt() {
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
    expect(lastTtl).toBe('15m');
  });

  test('honours LIVEKIT_TOKEN_TTL when set', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '2h';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastTtl).toBe('2h');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 2h → expiry ~7200s out.
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + 7000);
  });

  test('honours a bare-seconds LIVEKIT_TOKEN_TTL', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '90';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastTtl).toBe('90');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 90 → expiry ~90s out, not the 900s fallback.
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + 85);
    expect(result.value.expiresAt).toBeLessThanOrEqual(nowSeconds + 90 + 2);
  });

  test('accepts an oversized-but-parseable LIVEKIT_TOKEN_TTL', async () => {
    process.env.LIVEKIT_TOKEN_TTL = '3650d';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastTtl).toBe('3650d');
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 3650d → ~315,360,000s out; operator's env, operator's choice.
    const expected = 3650 * 86400;
    expect(result.value.expiresAt).toBeGreaterThan(nowSeconds + expected - 5);
    expect(result.value.expiresAt).toBeLessThanOrEqual(nowSeconds + expected + 2);
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

  test('defaults the url to ws://localhost:7880 when LIVEKIT_URL is unset', async () => {
    delete process.env.LIVEKIT_URL;
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.url).toBe('ws://localhost:7880');
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
