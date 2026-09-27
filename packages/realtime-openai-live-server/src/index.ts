import {
  LiveExchangeRequestSchema,
  LiveExchangeResponseSchema,
  type LiveSessionExchange,
  LiveTransportError,
} from '@maelstrom-co/realtime-protocol/openai-live';

/** Trusted server configuration. Never import this package into a browser. */
export interface LiveSessionExchangeOptions {
  /** Server-held OpenAI project key. */
  readonly apiKey: string;
  /** Upper bound for exchange including body reading; defaults to thirty seconds. */
  readonly timeoutMs?: number;
  /** Trusted fetch implementation for server runtimes and tests. It must honor redirect rejection. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Creates a single-attempt exchange against OpenAI's fixed HTTPS endpoint.
 * The wrapping host route owns authentication, authorization, configuration policy,
 * HTTPS, and rate limits. Cancellation cannot undo an already-created paid session.
 */
export function createLiveSessionExchange(
  options: LiveSessionExchangeOptions,
): LiveSessionExchange {
  if (!options.apiKey.trim()) throw new LiveTransportError('missing_key');
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  )
    throw new LiveTransportError('invalid_timeout');
  const request = options.fetch ?? globalThis.fetch;
  return async (input, signal) => {
    const parsed = LiveExchangeRequestSchema.safeParse(input);
    if (!parsed.success) throw new LiveTransportError('invalid_offer');
    if (signal.aborted) throw new LiveTransportError('aborted');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(
          new LiveTransportError(
            signal.aborted ? 'aborted' : 'exchange_timeout',
          ),
        );
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    try {
      controller.signal.throwIfAborted();
      const result = await Promise.race([
        aborted,
        (async () => {
          const response = await request(
            'https://api.openai.com/v1/live/sessions',
            {
              method: 'POST',
              redirect: 'error',
              credentials: 'omit',
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(parsed.data),
            },
          );
          const requestId = response.headers.get('x-request-id') ?? undefined;
          if (response.redirected || response.status !== 201) {
            await response.body?.cancel();
            throw new LiveTransportError('exchange_rejected', {
              status: response.status,
              requestId,
            });
          }
          const reader = response.body?.getReader();
          if (!reader)
            throw new LiveTransportError('invalid_answer', { requestId });
          let text = '';
          const cancel = () => {
            void reader.cancel().catch(() => {});
          };
          controller.signal.addEventListener('abort', cancel, { once: true });
          if (controller.signal.aborted) cancel();
          let bytes = 0;
          const decoder = new TextDecoder();
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 131_072)
                throw new LiveTransportError('answer_too_large', { requestId });
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            controller.signal.removeEventListener('abort', cancel);
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            throw new LiveTransportError('invalid_answer', { requestId });
          }
          const answer = LiveExchangeResponseSchema.safeParse(body);
          if (!answer.success)
            throw new LiveTransportError('invalid_answer', { requestId });
          return answer.data;
        })(),
      ]);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof LiveTransportError) throw error;
      throw new LiveTransportError(
        signal.aborted ? 'aborted' : 'exchange_failed',
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (rejectAbort)
        controller.signal.removeEventListener('abort', rejectAbort);
      controller.abort();
    }
  };
}
