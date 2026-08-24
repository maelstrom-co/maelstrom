import { describe, expect, it, vi } from 'vitest';

// worker/index.ts re-exports SessionDO from ./session-do so the Alchemy Worker
// declaration can bind the class, which pulls in the same runtime-only
// dependencies
// session-do.test.ts mocks: `cloudflare:workers` only exists inside an
// actual Workers runtime, not under plain vitest, and WebSocketRequestResponsePair
// is a Workers-runtime global rather than a module import.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
(
  globalThis as { WebSocketRequestResponsePair?: unknown }
).WebSocketRequestResponsePair ??= class {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
};
vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: vi.fn(),
}));
vi.mock('@tanstack/ai-openai', () => ({
  createOpenaiChat: (model: string, apiKey: string) => ({
    kind: 'text',
    name: 'fake',
    model,
    __testApiKey: apiKey,
  }),
}));

const worker = (await import('./index')).default;

function makeEnv() {
  const stub = { fetch: vi.fn(async () => new Response('do reached')) };
  const idFromName = vi.fn((name: string) => `id:${name}`);
  const get = vi.fn(() => stub);
  const rateLimit = vi.fn(async () => ({ success: true }));
  return {
    env: {
      SESSION_DO: { idFromName, get },
      ASSETS: { fetch: async () => new Response('assets') },
      WS_RATE_LIMITER: { limit: rateLimit },
    } as unknown as Parameters<typeof worker.fetch>[1],
    idFromName,
    get,
    rateLimit,
    stub,
  };
}

describe('worker /ws upgrade guard', () => {
  it('rejects a plain GET with 426 and never touches the DO namespace', async () => {
    const { env, idFromName, get } = makeEnv();
    const request = new Request('https://example.com/ws');

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(426);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects a GET carrying unrelated headers but no Upgrade header', async () => {
    const { env, get } = makeEnv();
    const request = new Request('https://example.com/ws?session=abc', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(426);
    expect(get).not.toHaveBeenCalled();
  });

  it('does not apply the upgrade guard to non-/ws paths', async () => {
    const { env, get } = makeEnv();
    const request = new Request('https://example.com/some-asset.js');

    const response = await worker.fetch(request, env);

    expect(await response.text()).toBe('assets');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('worker /ws routing to SessionDO', () => {
  it('rejects cross-origin browser upgrades before addressing a Durable Object', async () => {
    const { env, idFromName, get } = makeEnv();
    const request = new Request('https://example.com/ws?session=visitor-1', {
      headers: { Upgrade: 'websocket', Origin: 'https://attacker.example' },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(403);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('allows same-origin browser upgrades', async () => {
    const { env, idFromName, rateLimit } = makeEnv();
    const request = new Request('https://example.com/ws?session=visitor-1', {
      headers: { Upgrade: 'websocket', Origin: 'https://example.com' },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith('visitor-1');
    expect(rateLimit).toHaveBeenCalledWith({
      key: 'example.com:https://example.com',
    });
  });

  it('rejects a rate-limited upgrade before addressing a Durable Object', async () => {
    const { env, idFromName, get, rateLimit } = makeEnv();
    rateLimit.mockResolvedValue({ success: false });
    const request = new Request('https://example.com/ws?session=visitor-1', {
      headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '192.0.2.1' },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(429);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('routes an upgrade request to the SessionDO named after the session query param, matched case-insensitively', async () => {
    const { env, idFromName, get, stub } = makeEnv();
    const request = new Request('https://example.com/ws?session=visitor-1', {
      headers: { Upgrade: 'WebSocket' },
    });

    const response = await worker.fetch(request, env);

    // Session identity IS object identity now (shard.ts's hash bucketing is
    // gone) -- asserting the exact name passed to idFromName is what proves
    // the session query param actually reaches object identity, rather than
    // every visitor silently collapsing onto one object.
    expect(idFromName).toHaveBeenCalledWith('visitor-1');
    expect(get).toHaveBeenCalledWith('id:visitor-1');
    expect(stub.fetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe('do reached');
  });

  it('rejects an upgrade request with a 400 when the session query param is missing, without addressing a Durable Object', async () => {
    const { env, idFromName, get } = makeEnv();
    const request = new Request('https://example.com/ws', {
      headers: { Upgrade: 'websocket' },
    });

    const response = await worker.fetch(request, env);

    // SessionDO holds one engine and key slot per object. Defaulting a missing
    // session onto one shared object would let session-less visitors thrash or
    // share one engine, so reject the request before addressing a Durable
    // Object.
    expect(response.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects an upgrade request with a 400 when the session query param is present but empty, without addressing a Durable Object', async () => {
    const { env, idFromName, get } = makeEnv();
    const request = new Request('https://example.com/ws?session=', {
      headers: { Upgrade: 'websocket' },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects an oversized session identity before addressing a Durable Object', async () => {
    const { env, idFromName, get } = makeEnv();
    const request = new Request(
      `https://example.com/ws?session=${'x'.repeat(129)}`,
      { headers: { Upgrade: 'websocket' } },
    );

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
