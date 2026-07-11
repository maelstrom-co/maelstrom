import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserMintToken, createProxyMintToken } from './mint-token';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createBrowserMintToken', () => {
  it('maps OpenAI client_secrets response fields to TokenHandshakeResponse', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ value: 'ek_abc123', expires_at: 1_800_000_000 }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const mintToken = createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime');
    const result = await mintToken();

    expect(result).toEqual({
      provider: 'openai',
      value: 'ek_abc123',
      expiresAt: 1_800_000_000,
      model: 'gpt-realtime',
    });
  });

  it('sends the visitor key as a Bearer token and never in the body', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ value: 'ek_x', expires_at: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    await createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime')();

    expect(capturedInit?.headers).toMatchObject({ Authorization: 'Bearer sk-visitor-key' });
    const body = JSON.parse(String(capturedInit?.body));
    expect(JSON.stringify(body)).not.toContain('sk-visitor-key');
  });

  it('throws a user-actionable error on a 401 without leaking the key in the message', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;

    const mintToken = createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime');
    await expect(mintToken()).rejects.toThrow(/invalid api key/i);
  });

  it('throws immediately when no key is set, without calling fetch', async () => {
    const fetchSpy = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;

    const mintToken = createBrowserMintToken(() => null, 'gpt-realtime');
    await expect(mintToken()).rejects.toThrow(/key/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createProxyMintToken', () => {
  it('posts to /api/mint and maps the response the same way', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ provider: 'openai', value: 'ek_abc', expiresAt: 42, model: 'gpt-realtime' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await createProxyMintToken(() => 'sk-visitor-key', 'gpt-realtime')();

    expect(capturedUrl).toBe('/api/mint');
    expect(result).toEqual({ provider: 'openai', value: 'ek_abc', expiresAt: 42, model: 'gpt-realtime' });
  });
});
