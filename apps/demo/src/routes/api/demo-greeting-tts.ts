import { createFileRoute } from '@tanstack/react-router';
import {
  DEMO_GREETING_TTS_MAX_BYTES,
  DEMO_GREETING_TTS_PAYLOAD,
  DEMO_GREETING_TTS_URL,
  readBoundedWavResponse,
} from '../../lib/demo-greeting-tts';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

const GENERIC_JSON = JSON.stringify({ error: 'request-denied' });
const MISSING_KEY_JSON = JSON.stringify({ error: 'service-unavailable' });
const UPSTREAM_JSON = JSON.stringify({ error: 'upstream-unavailable' });
const BUDGET_JSON = JSON.stringify({ error: 'budget-exhausted' });
const ABORT_JSON = JSON.stringify({ error: 'request-aborted' });

const ROUTE_UPSTREAM_TIMEOUT_MS = 8000;
const MAX_UPSTREAM_ATTEMPTS = 3;
/** Fixed window that bounds burst upstream attempts without a permanent lock. */
const ATTEMPT_WINDOW_MS = 60_000;

export interface DemoGreetingTtsHandlerOptions {
  readonly getApiKey: () => string;
  readonly fetch?: typeof fetch;
  readonly upstreamTimeoutMs?: number;
  /** Injected clock for deterministic budget-window tests. */
  readonly now?: () => number;
}

interface HandlerState {
  attempts: number;
  windowStartedAt: number;
  inFlight: Promise<ArrayBuffer> | undefined;
  cachedWav: ArrayBuffer | undefined;
}

function refreshBudgetWindow(state: HandlerState, now: () => number): void {
  const current = now();
  if (current - state.windowStartedAt >= ATTEMPT_WINDOW_MS) {
    state.windowStartedAt = current;
    state.attempts = 0;
  }
}

function jsonResponse(
  body: string,
  status: number,
  extra?: HeadersInit,
): Response {
  return new Response(body, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'application/json',
      ...extra,
    },
  });
}

function wavResponse(bytes: ArrayBuffer): Response {
  return new Response(bytes.slice(0), {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'audio/wav',
      'Content-Length': String(bytes.byteLength),
    },
  });
}

async function hasDisallowedBody(request: Request): Promise<boolean> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const n = Number(contentLength);
    if (!Number.isFinite(n) || n < 0 || n > 0) return true;
  }

  if (request.body === null) return false;

  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (value.byteLength > 0) {
        await reader.cancel();
        return true;
      }
    }
  } catch {
    return true;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Factory for the fixed local greeting TTS route. Each instance owns isolated
 * attempt/cache state so tests never mutate production module state.
 */
export function createDemoGreetingTtsHandler(
  options: DemoGreetingTtsHandlerOptions,
): (request: Request) => Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.upstreamTimeoutMs ?? ROUTE_UPSTREAM_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const state: HandlerState = {
    attempts: 0,
    windowStartedAt: now(),
    inFlight: undefined,
    cachedWav: undefined,
  };

  async function runUpstream(): Promise<ArrayBuffer> {
    const apiKey = options.getApiKey();
    if (!apiKey) {
      throw new Error('missing-key');
    }
    refreshBudgetWindow(state, now);
    if (state.attempts >= MAX_UPSTREAM_ATTEMPTS) {
      throw new Error('budget');
    }

    state.attempts += 1;
    const upstreamSignal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(DEMO_GREETING_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(DEMO_GREETING_TTS_PAYLOAD),
        signal: upstreamSignal,
        // Fail closed: never follow redirects with the server key.
        redirect: 'error',
      });
    } catch {
      throw new Error('upstream');
    }

    try {
      const bytes = await readBoundedWavResponse(response);
      // Validated success clears the burst counter for future process lifetime.
      state.attempts = 0;
      return bytes;
    } catch {
      throw new Error('upstream');
    }
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonResponse(GENERIC_JSON, 405, { Allow: 'POST' });
    }

    const origin = request.headers.get('Origin');
    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(request.url).origin;
    } catch {
      return jsonResponse(GENERIC_JSON, 403);
    }
    if (origin !== expectedOrigin) {
      return jsonResponse(GENERIC_JSON, 403);
    }

    if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') {
      return jsonResponse(GENERIC_JSON, 403);
    }

    if (await hasDisallowedBody(request)) {
      return jsonResponse(GENERIC_JSON, 400);
    }

    if (!options.getApiKey()) {
      return jsonResponse(MISSING_KEY_JSON, 500);
    }

    if (state.cachedWav) {
      return wavResponse(state.cachedWav);
    }

    refreshBudgetWindow(state, now);
    if (state.attempts >= MAX_UPSTREAM_ATTEMPTS && !state.inFlight) {
      return jsonResponse(BUDGET_JSON, 429);
    }

    let shared = state.inFlight;
    if (!shared) {
      shared = runUpstream()
        .then((bytes) => {
          // Only cache validated exact-size WAV under the byte budget.
          if (
            bytes.byteLength > 0 &&
            bytes.byteLength <= DEMO_GREETING_TTS_MAX_BYTES
          ) {
            state.cachedWav = bytes.slice(0);
          }
          return bytes;
        })
        .finally(() => {
          if (state.inFlight === shared) {
            state.inFlight = undefined;
          }
        });
      state.inFlight = shared;
      // Observe late rejection so a sole waiter abort cannot leave unhandled.
      void shared.then(
        () => {},
        () => {},
      );
    }

    // Caller abort stops only this waiter; shared work continues for others.
    const callerSignal = request.signal;
    try {
      if (callerSignal.aborted) {
        return jsonResponse(ABORT_JSON, 408);
      }
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          callerSignal.removeEventListener('abort', onAbort);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        callerSignal.addEventListener('abort', onAbort, { once: true });
        const pending = shared;
        if (!pending) {
          reject(new Error('upstream'));
          return;
        }
        pending.then(
          (value) => {
            if (settled) return;
            settled = true;
            callerSignal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            callerSignal.removeEventListener('abort', onAbort);
            reject(error);
          },
        );
      });
      return wavResponse(bytes);
    } catch (error) {
      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return jsonResponse(ABORT_JSON, 408);
      }
      if (error instanceof Error) {
        if (error.message === 'missing-key') {
          return jsonResponse(MISSING_KEY_JSON, 500);
        }
        if (error.message === 'budget') {
          return jsonResponse(BUDGET_JSON, 429);
        }
      }
      return jsonResponse(UPSTREAM_JSON, 502);
    }
  };
}

const productionHandler = createDemoGreetingTtsHandler({
  getApiKey: () => process.env.OPENAI_API_KEY ?? '',
});

export const Route = createFileRoute('/api/demo-greeting-tts')({
  server: {
    handlers: {
      POST: ({ request }) => productionHandler(request),
    },
  },
});
