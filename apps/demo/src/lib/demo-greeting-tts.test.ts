import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeValidWavBytes } from './__tests__/wav-fixtures';
import {
  createHostedDemoGreetingSynthesizer,
  createLocalDemoGreetingSynthesizer,
  DEMO_GREETING,
  DEMO_GREETING_TTS_INSTRUCTIONS,
  DEMO_GREETING_TTS_MAX_BYTES,
  DEMO_GREETING_TTS_MODEL,
  DEMO_GREETING_TTS_PAYLOAD,
  DEMO_GREETING_TTS_ROUTE,
  DEMO_GREETING_TTS_URL,
  DEMO_OPENAI_VOICE,
  readBoundedWavResponse,
} from './demo-greeting-tts';

/** RIFF/WAVE magic only — no fmt/data chunks. */
function makeRiffWaveHeaderOnly(byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, Math.max(byteLength - 8, 0), true);
  if (byteLength >= 12) {
    bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  }
  return bytes.buffer;
}

function wavResponse(
  body: ArrayBuffer,
  init?: { status?: number; contentType?: string; contentLength?: string },
): Response {
  const headers = new Headers();
  headers.set('Content-Type', init?.contentType ?? 'audio/wav');
  if (init?.contentLength !== undefined) {
    headers.set('Content-Length', init.contentLength);
  } else {
    headers.set('Content-Length', String(body.byteLength));
  }
  return new Response(body, { status: init?.status ?? 200, headers });
}

/**
 * Response-like stub for early-reject paths. Body is never read; `cancel` is
 * spied so tests can prove unread upstream bytes are dropped.
 */
function earlyRejectResponse(init: {
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  cancel?: () => void | Promise<void>;
}): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn(init.cancel ?? (() => undefined));
  const headers = new Headers();
  if (init.contentType !== null) {
    headers.set('Content-Type', init.contentType ?? 'audio/wav');
  }
  if (init.contentLength !== undefined && init.contentLength !== null) {
    headers.set('Content-Length', init.contentLength);
  }
  const status = init.status ?? 200;
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers,
    body: {
      cancel,
      getReader() {
        throw new Error('body must not be read on early reject');
      },
    },
  } as unknown as Response;
  return { response, cancel };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('DEMO_GREETING_TTS_PAYLOAD', () => {
  it('is exactly the five allowed fields with fixed natural-delivery values', () => {
    expect(DEMO_GREETING).toBe(
      "Hi, I'm the Maelstrom demo assistant, how can I help you today?",
    );
    expect(DEMO_GREETING_TTS_PAYLOAD).toEqual({
      model: 'gpt-4o-mini-tts',
      input: DEMO_GREETING,
      voice: 'cedar',
      response_format: 'wav',
      instructions: DEMO_GREETING_TTS_INSTRUCTIONS,
    });
    expect(Object.keys(DEMO_GREETING_TTS_PAYLOAD).sort()).toEqual([
      'input',
      'instructions',
      'model',
      'response_format',
      'voice',
    ]);
    expect(JSON.stringify(DEMO_GREETING_TTS_PAYLOAD)).toBe(
      JSON.stringify({
        model: DEMO_GREETING_TTS_MODEL,
        input: DEMO_GREETING,
        voice: DEMO_OPENAI_VOICE,
        response_format: 'wav',
        instructions: DEMO_GREETING_TTS_INSTRUCTIONS,
      }),
    );
  });
});

describe('makeValidWavBytes', () => {
  it('rejects lengths that cannot produce its valid unpadded layout', () => {
    expect(() => makeValidWavBytes(43)).toThrow(/at least 44 bytes/i);
    expect(() => makeValidWavBytes(45)).toThrow(/even byte length/i);
  });
});

describe('readBoundedWavResponse', () => {
  it('accepts a valid chunked WAV and returns exact bytes', async () => {
    const wav = makeValidWavBytes(64);
    const response = wavResponse(wav);
    const out = await readBoundedWavResponse(response);
    expect(out.byteLength).toBe(64);
    expect(new Uint8Array(out)).toEqual(new Uint8Array(wav));
  });

  it('rejects non-2xx without requiring a body read of upstream detail', async () => {
    const response = new Response('secret upstream error sk-leak', {
      status: 500,
      headers: { 'Content-Type': 'audio/wav' },
    });
    await expect(readBoundedWavResponse(response)).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });

  it('cancels unread body on non-OK status and keeps the error generic', async () => {
    const { response, cancel } = earlyRejectResponse({
      status: 500,
      contentType: 'audio/wav',
    });
    let error: unknown;
    try {
      await readBoundedWavResponse(response);
    } catch (err) {
      error = err;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/temporarily unavailable/i);
    expect((error as Error).message).not.toMatch(/cancel/i);
  });

  it('cancels unread body on invalid Content-Type and keeps the error generic', async () => {
    const { response, cancel } = earlyRejectResponse({
      contentType: 'application/octet-stream',
    });
    await expect(readBoundedWavResponse(response)).rejects.toThrow(
      /temporarily unavailable/i,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels unread body on invalid Content-Length and keeps the error generic', async () => {
    const { response, cancel } = earlyRejectResponse({
      contentLength: 'nope',
    });
    await expect(readBoundedWavResponse(response)).rejects.toThrow(
      /temporarily unavailable/i,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('swallows body.cancel failures and still throws the generic public error', async () => {
    const { response, cancel } = earlyRejectResponse({
      status: 502,
      cancel: () => {
        throw new Error('cancel-failed-secret');
      },
    });
    let error: unknown;
    try {
      await readBoundedWavResponse(response);
    } catch (err) {
      error = err;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/temporarily unavailable/i);
    expect((error as Error).message).not.toContain('cancel-failed-secret');
  });

  it('rejects bad or missing media types', async () => {
    const wav = makeValidWavBytes();
    await expect(
      readBoundedWavResponse(
        wavResponse(wav, { contentType: 'application/octet-stream' }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
    await expect(
      readBoundedWavResponse(new Response(wav, { status: 200 })),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('accepts WAV media types case-insensitively with parameters', async () => {
    const wav = makeValidWavBytes();
    const out = await readBoundedWavResponse(
      wavResponse(wav, { contentType: 'Audio/WAV; charset=binary' }),
    );
    expect(out.byteLength).toBe(wav.byteLength);
  });

  it('rejects invalid Content-Length and over-limit headers', async () => {
    const wav = makeValidWavBytes();
    await expect(
      readBoundedWavResponse(wavResponse(wav, { contentLength: '0' })),
    ).rejects.toThrow(/temporarily unavailable/i);
    await expect(
      readBoundedWavResponse(wavResponse(wav, { contentLength: '-1' })),
    ).rejects.toThrow(/temporarily unavailable/i);
    await expect(
      readBoundedWavResponse(wavResponse(wav, { contentLength: 'nope' })),
    ).rejects.toThrow(/temporarily unavailable/i);
    await expect(
      readBoundedWavResponse(
        wavResponse(wav, {
          contentLength: String(DEMO_GREETING_TTS_MAX_BYTES + 1),
        }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects empty and short bodies below the WAV floor', async () => {
    await expect(
      readBoundedWavResponse(wavResponse(new ArrayBuffer(0))),
    ).rejects.toThrow(/temporarily unavailable/i);
    const short = new Uint8Array(16);
    short.set([1, 2, 3, 4], 0);
    await expect(
      readBoundedWavResponse(wavResponse(short.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
    const headerOnly = new Uint8Array(12);
    headerOnly.set([0x52, 0x49, 0x46, 0x46], 0);
    headerOnly[4] = 4;
    headerOnly.set([0x57, 0x41, 0x56, 0x45], 8);
    await expect(
      readBoundedWavResponse(
        new Response(headerOnly, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects invalid RIFF magic with a body large enough to pass the byte floor', async () => {
    const bad = new Uint8Array(64);
    bad.set([1, 2, 3, 4], 0);
    await expect(
      readBoundedWavResponse(wavResponse(bad.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects RIFF/WAVE without complete fmt and data chunks', async () => {
    await expect(
      readBoundedWavResponse(wavResponse(makeRiffWaveHeaderOnly(64))),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects missing fmt chunk', async () => {
    const wav = new Uint8Array(makeValidWavBytes(48));
    // Overwrite "fmt " with "JUNK"
    wav.set([0x4a, 0x55, 0x4e, 0x4b], 12);
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects missing data chunk', async () => {
    const wav = new Uint8Array(makeValidWavBytes(48));
    // Overwrite "data" with "JUNK"
    wav.set([0x4a, 0x55, 0x4e, 0x4b], 36);
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects chunk sizes that extend past actual bytes', async () => {
    const wav = new Uint8Array(makeValidWavBytes(48));
    const view = new DataView(wav.buffer);
    // data chunk claims more payload than remains
    view.setUint32(40, 1000, true);
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects truncated chunk headers at clean EOF', async () => {
    // Complete fmt + data, then only 4 bytes of a trailing chunk id (no size).
    // 52 bytes: header(12) + fmt(24) + data hdr+4(12) + partial id(4).
    const wav = new Uint8Array(52);
    const view = new DataView(wav.buffer);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, 44, true);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    wav.set([0x66, 0x6d, 0x74, 0x20], 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24_000, true);
    view.setUint32(28, 48_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    wav.set([0x64, 0x61, 0x74, 0x61], 36);
    view.setUint32(40, 4, true);
    // Truncated next chunk header (id only).
    wav.set([0x4c, 0x49, 0x53, 0x54], 48);
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects malformed odd-sized chunk padding', async () => {
    // fmt (16) + odd-sized data (1) without the required pad byte.
    const wav = new Uint8Array(45);
    const view = new DataView(wav.buffer);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, 37, true);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    wav.set([0x66, 0x6d, 0x74, 0x20], 12);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24_000, true);
    view.setUint32(28, 48_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    wav.set([0x64, 0x61, 0x74, 0x61], 36);
    view.setUint32(40, 1, true);
    wav[44] = 0;
    // File ends at byte 45; odd data size requires a pad at offset 45.
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('accepts OpenAI streamed WAV with the unknown-length RIFF marker', async () => {
    const wav = new Uint8Array(makeValidWavBytes(163_244));
    new DataView(wav.buffer).setUint32(4, 0xffff_ffff, true);
    const response = new Response(wav, {
      status: 200,
      headers: { 'Content-Type': 'audio/wav' },
    });
    expect(response.headers.get('Content-Length')).toBeNull();

    const out = await readBoundedWavResponse(response);

    expect(out.byteLength).toBe(wav.byteLength);
  });

  it('accepts streamed WAV with unknown RIFF and data sizes and real PCM bytes', async () => {
    const wav = new Uint8Array(makeValidWavBytes(163_244));
    const view = new DataView(wav.buffer);
    view.setUint32(4, 0xffff_ffff, true); // RIFF chunk size unknown
    view.setUint32(40, 0xffff_ffff, true); // final data chunk size unknown
    for (let i = 44; i < wav.byteLength; i += 1) {
      wav[i] = i & 0xff;
    }
    const response = new Response(wav, {
      status: 200,
      headers: { 'Content-Type': 'audio/wav' },
    });
    expect(response.headers.get('Content-Length')).toBeNull();

    const out = await readBoundedWavResponse(response);

    expect(out.byteLength).toBe(wav.byteLength);
    expect(new Uint8Array(out).subarray(44)).toEqual(wav.subarray(44));
  });

  it('rejects 0xFFFFFFFF size markers on non-data chunks', async () => {
    const wav = new Uint8Array(makeValidWavBytes(64));
    const view = new DataView(wav.buffer);
    view.setUint32(4, 0xffff_ffff, true);
    // fmt chunk claims unknown size — not allowed.
    view.setUint32(16, 0xffff_ffff, true);
    await expect(
      readBoundedWavResponse(
        new Response(wav, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects unknown data size under a finite RIFF declaration', async () => {
    const wav = new Uint8Array(makeValidWavBytes(64));
    const view = new DataView(wav.buffer);
    // Finite RIFF size (from fixture) + unknown data marker must fail.
    view.setUint32(40, 0xffff_ffff, true);
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects a network-truncated unknown-length WAV stream', async () => {
    const wav = new Uint8Array(makeValidWavBytes(64));
    new DataView(wav.buffer).setUint32(4, 0xffff_ffff, true);
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(wav);
          return;
        }
        controller.error(new Error('connection reset'));
      },
    });

    await expect(
      readBoundedWavResponse(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects when RIFF declared size exceeds actual streamed bytes', async () => {
    const wav = new Uint8Array(makeValidWavBytes(44));
    // Claim a much larger file than arrived.
    const view = new DataView(wav.buffer);
    view.setUint32(4, 10_000, true);
    await expect(
      readBoundedWavResponse(wavResponse(wav.buffer)),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects when Content-Length does not match actual bytes (truncation)', async () => {
    const wav = makeValidWavBytes(64);
    await expect(
      readBoundedWavResponse(
        wavResponse(wav, { contentLength: String(wav.byteLength + 20) }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
    await expect(
      readBoundedWavResponse(
        wavResponse(wav, { contentLength: String(wav.byteLength - 4) }),
      ),
    ).rejects.toThrow(/temporarily unavailable/i);
  });

  it('rejects actual streamed bytes above the max even when header is absent', async () => {
    const oversized = new Uint8Array(DEMO_GREETING_TTS_MAX_BYTES + 8);
    oversized.set([0x52, 0x49, 0x46, 0x46], 0);
    oversized.set([0x57, 0x41, 0x56, 0x45], 8);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'audio/wav' },
    });
    await expect(readBoundedWavResponse(response)).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });
});

describe('createLocalDemoGreetingSynthesizer', () => {
  it('POSTs bodyless to the same-origin route with a timeout signal', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return wavResponse(makeValidWavBytes());
    }) as unknown as typeof fetch;

    const synth = createLocalDemoGreetingSynthesizer();
    const signal = new AbortController().signal;
    await synth({ text: DEMO_GREETING, voice: DEMO_OPENAI_VOICE, signal });

    expect(capturedUrl).toBe(DEMO_GREETING_TTS_ROUTE);
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBeUndefined();
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.redirect).toBe('error');
  });

  it('rejects text/voice mismatch before fetch', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const synth = createLocalDemoGreetingSynthesizer();
    await expect(
      synth({
        text: 'wrong',
        voice: DEMO_OPENAI_VOICE,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/temporarily unavailable/i);
    await expect(
      synth({
        text: DEMO_GREETING,
        voice: 'marin',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/temporarily unavailable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createHostedDemoGreetingSynthesizer', () => {
  it('sends exact payload and visitor key only in Authorization, lazily', async () => {
    let keyReads = 0;
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return wavResponse(makeValidWavBytes());
    }) as unknown as typeof fetch;

    const synth = createHostedDemoGreetingSynthesizer(() => {
      keyReads += 1;
      return 'sk-visitor-secret';
    });
    expect(keyReads).toBe(0);

    await synth({
      text: DEMO_GREETING,
      voice: DEMO_OPENAI_VOICE,
      signal: new AbortController().signal,
    });

    expect(keyReads).toBe(1);
    expect(capturedUrl).toBe(DEMO_GREETING_TTS_URL);
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer sk-visitor-secret',
      'Content-Type': 'application/json',
    });
    expect(capturedInit?.body).toBe(JSON.stringify(DEMO_GREETING_TTS_PAYLOAD));
    expect(String(capturedInit?.body)).not.toContain('sk-visitor-secret');
    expect(capturedInit?.redirect).toBe('error');
  });

  it('rejects absent key before fetch', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const synth = createHostedDemoGreetingSynthesizer(() => null);
    await expect(
      synth({
        text: DEMO_GREETING,
        voice: DEMO_OPENAI_VOICE,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/key/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 401 to invalid key without leaking secrets or upstream body', async () => {
    const { response, cancel } = earlyRejectResponse({ status: 401 });
    globalThis.fetch = vi.fn(async () => response) as unknown as typeof fetch;
    const synth = createHostedDemoGreetingSynthesizer(
      () => 'sk-visitor-secret',
    );
    let error: unknown;
    try {
      await synth({
        text: DEMO_GREETING,
        voice: DEMO_OPENAI_VOICE,
        signal: new AbortController().signal,
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/invalid api key/i);
    expect((error as Error).message).not.toContain('sk-visitor-secret');
    expect((error as Error).message).not.toContain('upstream');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not hang on abort and keeps errors free of key material', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;

    const synth = createHostedDemoGreetingSynthesizer(
      () => 'sk-visitor-secret',
    );
    const promise = synth({
      text: DEMO_GREETING,
      voice: DEMO_OPENAI_VOICE,
      signal: controller.signal,
    });
    controller.abort();
    let error: unknown;
    try {
      await promise;
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('sk-visitor-secret');
  });
});
