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

const { mintLiveKitToken } = await import('./server');

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
