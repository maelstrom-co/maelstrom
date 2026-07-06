import { test, expect, mock, beforeEach, afterEach, describe } from 'bun:test';

// Capture the grant passed to AccessToken so the test can assert the token is
// scoped to the requested room + identity.
let lastIdentity: string | undefined;
let lastGrant: Record<string, unknown> | undefined;

mock.module('livekit-server-sdk', () => ({
  AccessToken: class {
    #identity: string | undefined;
    constructor(_key: string, _secret: string, opts?: { identity?: string }) {
      this.#identity = opts?.identity;
      lastIdentity = opts?.identity;
    }
    addGrant(grant: Record<string, unknown>) {
      lastGrant = grant;
    }
    async toJwt() {
      return `jwt-for-${this.#identity}`;
    }
  },
}));

// createServerFn is irrelevant to the token-minting logic under test (these
// tests call mintLiveKitToken directly), but the stub must match the one in
// livekit-voice.test.ts: Bun registers module mocks process-globally, so a
// divergent stub would make the getLivekitToken binding order-dependent. The
// token handler delegates to a global hook set by the hook test.
type MockToken = { token: string; url: string };
const g = globalThis as { __mockGetToken?: (arg: unknown) => Promise<MockToken> };
g.__mockGetToken ??= async () => ({
  token: 'test-token',
  url: 'ws://localhost:7880',
});
mock.module('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: () => (arg: unknown) => g.__mockGetToken!(arg),
    }),
  }),
}));

const { mintLiveKitToken } = await import('./get-livekit-token');

describe('mintLiveKitToken', () => {
  const original = {
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET,
    url: process.env.LIVEKIT_URL,
  };

  beforeEach(() => {
    lastIdentity = undefined;
    lastGrant = undefined;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
  });

  afterEach(() => {
    process.env.LIVEKIT_API_KEY = original.key;
    process.env.LIVEKIT_API_SECRET = original.secret;
    process.env.LIVEKIT_URL = original.url;
  });

  test('returns a token and url', async () => {
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.url).toBe('ws://localhost:7880');
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

  test('defaults the url to ws://localhost:7880 when LIVEKIT_URL is unset', async () => {
    delete process.env.LIVEKIT_URL;
    const result = await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(result.url).toBe('ws://localhost:7880');
  });

  test('throws when credentials are missing', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    await expect(
      mintLiveKitToken({ roomName: 'maelstrom-abc' }),
    ).rejects.toThrow('LiveKit credentials not configured');
  });
});
