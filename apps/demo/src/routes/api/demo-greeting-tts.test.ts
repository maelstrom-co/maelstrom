import { describe, expect, it, vi } from 'vitest';
import { makeValidWavBytes } from '../../lib/__tests__/wav-fixtures';
import {
  DEMO_GREETING_TTS_PAYLOAD,
  DEMO_GREETING_TTS_URL,
} from '../../lib/demo-greeting-tts';
import { createDemoGreetingTtsHandler } from './demo-greeting-tts';

const SECRET = 'sk-server-only-secret';
const ORIGIN = 'http://localhost:3000';

/** RIFF/WAVE magic only — structurally incomplete (no fmt/data). */
function makeMalformedWavBytes(byteLength = 64): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, byteLength - 8, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  return bytes.buffer;
}

function validRequest(init?: {
  method?: string;
  origin?: string | null;
  secFetchSite?: string | null;
  body?: BodyInit | null;
  signal?: AbortSignal;
  contentLength?: string;
}): Request {
  const headers = new Headers();
  if (init?.origin !== null) {
    headers.set('Origin', init?.origin ?? ORIGIN);
  }
  if (init?.secFetchSite !== null) {
    headers.set('Sec-Fetch-Site', init?.secFetchSite ?? 'same-origin');
  }
  if (init?.contentLength !== undefined) {
    headers.set('Content-Length', init.contentLength);
  }
  return new Request(`${ORIGIN}/api/demo-greeting-tts`, {
    method: init?.method ?? 'POST',
    headers,
    body: init?.body === undefined ? null : init.body,
    signal: init?.signal,
  });
}

function wavUpstream(body: ArrayBuffer = makeValidWavBytes()): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(body.byteLength),
    },
  });
}

describe('createDemoGreetingTtsHandler', () => {
  it('rejects wrong method, origin, sec-fetch-site, and body before upstream', async () => {
    const fetchSpy = vi.fn(async () => wavUpstream());
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const method = await handle(validRequest({ method: 'GET' }));
    expect(method.status).toBe(405);
    expect(method.headers.get('Allow')).toBe('POST');

    const origin = await handle(
      validRequest({ origin: 'https://evil.example' }),
    );
    expect(origin.status).toBe(403);

    const noOrigin = await handle(validRequest({ origin: null }));
    expect(noOrigin.status).toBe(403);

    const site = await handle(validRequest({ secFetchSite: 'cross-site' }));
    expect(site.status).toBe(403);

    const body = await handle(validRequest({ body: '{}' }));
    expect(body.status).toBe(400);

    const length = await handle(validRequest({ contentLength: '12' }));
    expect(length.status).toBe(400);

    expect(fetchSpy).not.toHaveBeenCalled();
    for (const res of [method, origin, noOrigin, site, body, length]) {
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      const text = await res.text();
      expect(text).not.toContain(SECRET);
    }
  });

  it('accepts the empty request stream produced by the server runtime', async () => {
    const fetchSpy = vi.fn(async () => wavUpstream());
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const res = await handle(validRequest({ body: new Uint8Array(0) }));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('calls OpenAI with exact URL, auth, payload, and timeout signal', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async (url: string, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedInit = init;
        return wavUpstream();
      }) as unknown as typeof fetch,
    });

    const res = await handle(validRequest());
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(DEMO_GREETING_TTS_URL);
    expect(capturedInit?.headers).toMatchObject({
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    });
    expect(capturedInit?.body).toBe(JSON.stringify(DEMO_GREETING_TTS_PAYLOAD));
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.redirect).toBe('error');
    expect(res.headers.get('Content-Type')).toBe('audio/wav');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x52); // R
  });

  it('returns generic 500 for missing key without consuming an attempt', async () => {
    const fetchSpy = vi.fn(async () => wavUpstream());
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => '',
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const res = await handle(validRequest());
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/OPENAI_API_KEY/i);
  });

  it('coalesces concurrent requests into one upstream call', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async () => {
        calls += 1;
        return gate;
      }) as unknown as typeof fetch,
    });

    const a = handle(validRequest());
    const b = handle(validRequest());
    await Promise.resolve();
    expect(calls).toBe(1);
    release(wavUpstream());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(calls).toBe(1);
  });

  it('caches the first validated success and skips further upstream calls', async () => {
    let calls = 0;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async () => {
        calls += 1;
        return wavUpstream();
      }) as unknown as typeof fetch,
    });

    const first = await handle(validRequest());
    const second = await handle(validRequest());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);
  });

  it('consumes attempts on failure and rejects the fourth without fetch', async () => {
    let calls = 0;
    let now = 1_000_000;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      now: () => now,
      fetch: (async () => {
        calls += 1;
        return new Response('nope', { status: 500 });
      }) as unknown as typeof fetch,
    });

    for (let i = 0; i < 3; i += 1) {
      const res = await handle(validRequest());
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('nope');
    }
    expect(calls).toBe(3);

    const fourth = await handle(validRequest());
    expect(fourth.status).toBe(429);
    expect(calls).toBe(3);

    // After the 60s attempt window, budget refreshes and upstream is tried again.
    now += 60_000;
    const fifth = await handle(validRequest());
    expect(fifth.status).toBe(502);
    expect(calls).toBe(4);
  });

  it('resets attempt budget after a successful validated upstream response', async () => {
    let calls = 0;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async () => {
        calls += 1;
        if (calls <= 2) {
          return new Response('nope', { status: 500 });
        }
        return wavUpstream();
      }) as unknown as typeof fetch,
    });

    expect((await handle(validRequest())).status).toBe(502);
    expect((await handle(validRequest())).status).toBe(502);
    expect(calls).toBe(2);

    // Success validates, caches WAV, and zeroes attempts.
    expect((await handle(validRequest())).status).toBe(200);
    expect(calls).toBe(3);

    // Cached — no more upstream.
    expect((await handle(validRequest())).status).toBe(200);
    expect(calls).toBe(3);
  });

  it('does not cache malformed WAV and keeps consuming the attempt budget', async () => {
    let calls = 0;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async () => {
        calls += 1;
        if (calls === 1) {
          return wavUpstream(makeMalformedWavBytes());
        }
        return wavUpstream();
      }) as unknown as typeof fetch,
    });

    const first = await handle(validRequest());
    expect(first.status).toBe(502);
    const second = await handle(validRequest());
    expect(second.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('caller abort stops only that waiter while shared work can finish/cache', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async () => {
        calls += 1;
        return gate;
      }) as unknown as typeof fetch,
    });

    const controllerA = new AbortController();
    const a = handle(validRequest({ signal: controllerA.signal }));
    const b = handle(validRequest());
    await Promise.resolve();
    controllerA.abort();
    const ra = await a;
    expect(ra.status).toBe(408);

    release(wavUpstream());
    const rb = await b;
    expect(rb.status).toBe(200);
    expect(calls).toBe(1);

    // Cached for a later request.
    const c = await handle(validRequest());
    expect(c.status).toBe(200);
    expect(calls).toBe(1);
  });

  it('does not cache upstream validation failures', async () => {
    let calls = 0;
    const handle = createDemoGreetingTtsHandler({
      getApiKey: () => SECRET,
      fetch: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('bad', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        return wavUpstream();
      }) as unknown as typeof fetch,
    });

    const first = await handle(validRequest());
    expect(first.status).toBe(502);
    const second = await handle(validRequest());
    expect(second.status).toBe(200);
    expect(calls).toBe(2);
  });
});
