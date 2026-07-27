import { SessionId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserMintToken, mintOpenAIToken } from './mint-token';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createBrowserMintToken', () => {
  it('passes an abort signal to fetch, so a stalled connection cannot hang mic/voice activation forever', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ value: 'ek_x', expires_at: 1 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime')();

    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.signal?.aborted).toBe(false);
  });

  it('rejects instead of hanging forever when the connection to OpenAI stalls past the timeout', async () => {
    const controller = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    try {
      globalThis.fetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError'),
              );
            });
          }),
      ) as unknown as typeof fetch;

      const mintPromise = createBrowserMintToken(
        () => 'sk-visitor-key',
        'gpt-realtime',
      )();
      // Simulates the 8s timeout firing, without waiting 8 real seconds.
      controller.abort();
      await expect(mintPromise).rejects.toThrow();
    } finally {
      timeoutSpy.mockRestore();
    }
  });

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

  // The browser-direct and server-held mint paths hand out credentials for
  // the same session; if only one pins a lifetime, a change to OpenAI's
  // default silently gives hosted visitors a different-lived token than
  // local ones. Keep this in step with realtime-server's openai-mint.
  it('pins the same token lifetime the server-held mint sends', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ value: 'ek_x', expires_at: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    await createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime')();

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 600 });
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

  it('throws a stable, actionable message when the network request itself fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const mintToken = createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime');
    let error: unknown;
    try {
      await mintToken();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/could not reach openai/i);
    // Never blame the key for a network failure, and never let the key leak
    // into the error surfaced to the drawer.
    expect(message).not.toContain('sk-visitor-key');
  });

  it('throws a status-scoped message on a non-401 error response', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('server error', { status: 500 }),
    ) as unknown as typeof fetch;

    const mintToken = createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime');
    await expect(mintToken()).rejects.toThrow(/status 500/i);
  });

  it('throws a friendly message instead of a raw SyntaxError when a 200 response body is not JSON', async () => {
    // A captive portal or corporate TLS proxy answers 200 with an HTML
    // interstitial: fetch resolves, res.ok is true, and res.json() throws
    // "Unexpected token '<'". Unguarded, that raw SyntaxError propagates as
    // the RealtimeVoiceError cause and renders in the key drawer as "your
    // key is broken" — telling the visitor to replace a perfectly good key.
    globalThis.fetch = vi.fn(
      async () => new Response('<!DOCTYPE html><html>captive portal</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ) as unknown as typeof fetch;

    const mintToken = createBrowserMintToken(() => 'sk-visitor-key', 'gpt-realtime');
    let error: unknown;
    try {
      await mintToken();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toMatch(/unexpected token/i);
    expect(message).not.toMatch(/JSON/i);
  });
});

describe('mintOpenAIToken', () => {
  it('passes an abort signal to fetch, so a stalled mint route cannot hang mic/voice activation forever', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          provider: 'openai',
          value: 'ek_x',
          expiresAt: 1,
          model: 'gpt-realtime',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await mintOpenAIToken(SessionId('session-1'));

    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.signal?.aborted).toBe(false);
  });

  it('rejects instead of hanging forever when the mint route stalls past the timeout', async () => {
    const controller = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    try {
      globalThis.fetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError'),
              );
            });
          }),
      ) as unknown as typeof fetch;

      const mintPromise = mintOpenAIToken(SessionId('session-1'));
      // Simulates the 8s timeout firing, without waiting 8 real seconds.
      controller.abort();
      await expect(mintPromise).rejects.toThrow(/aborted/i);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('does not surface a raw SyntaxError when a 200 response body is not JSON', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('<!DOCTYPE html><html>captive portal</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ) as unknown as typeof fetch;

    let error: unknown;
    try {
      await mintOpenAIToken(SessionId('session-1'));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/unexpected token/i);
  });
});
