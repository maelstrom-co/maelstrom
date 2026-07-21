import { test, expect, mock, beforeEach, afterEach, describe } from 'bun:test';

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

const { mintLiveKitToken } = await import('./server');

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
  };

  beforeEach(() => {
    lastIdentity = undefined;
    lastTtl = undefined;
    lastGrant = undefined;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
  });

  afterEach(() => {
    restoreEnv('LIVEKIT_API_KEY', original.key);
    restoreEnv('LIVEKIT_API_SECRET', original.secret);
    restoreEnv('LIVEKIT_URL', original.url);
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

  test('bounds the token to a 1 hour ttl', async () => {
    await mintLiveKitToken({ roomName: 'maelstrom-abc' });
    expect(lastTtl).toBe('1h');
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
