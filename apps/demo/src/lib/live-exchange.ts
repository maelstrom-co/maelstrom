import {
  LiveExchangeRequestSchema,
  LiveExchangeResponseSchema,
  type LiveSessionExchange,
  LiveTransportError,
} from '@maelstrom-co/realtime-protocol/openai-live';

export function createDemoLiveExchange(
  getKey: (() => string | null) | undefined,
  request: typeof fetch = globalThis.fetch,
): LiveSessionExchange {
  return async (input, signal) => {
    const parsed = LiveExchangeRequestSchema.safeParse(input);
    if (!parsed.success) throw new LiveTransportError('invalid_offer');
    const key = getKey?.();
    if (getKey && !key) throw new LiveTransportError('missing_key');
    const timeout = AbortSignal.timeout(30_000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await request(
        getKey
          ? 'https://api.openai.com/v1/live/sessions'
          : '/api/live-session',
        {
          method: 'POST',
          redirect: 'error',
          credentials: getKey ? 'omit' : 'same-origin',
          signal: combined,
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(parsed.data),
        },
      );
      if (response.redirected || response.status !== 201) {
        await response.body?.cancel();
        throw new LiveTransportError(
          !getKey &&
            (response.headers.get('X-Maelstrom-Live-Access') === 'denied' ||
              (response.status === 401 &&
                response.headers.has('WWW-Authenticate')))
            ? 'local_exchange_unavailable'
            : 'exchange_rejected',
          {
            status: response.status,
          },
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new LiveTransportError('invalid_answer');
      let text = '';
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 131_072) throw new LiveTransportError('answer_too_large');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const answer = LiveExchangeResponseSchema.safeParse(JSON.parse(text));
      if (!answer.success) throw new LiveTransportError('invalid_answer');
      return answer.data;
    } catch (error) {
      if (error instanceof LiveTransportError) throw error;
      throw new LiveTransportError(
        signal.aborted
          ? 'aborted'
          : timeout.aborted
            ? 'exchange_timeout'
            : 'exchange_failed',
      );
    }
  };
}

export function liveErrorMessage(error: unknown): string {
  if (error instanceof LiveTransportError) {
    if (error.code === 'local_exchange_unavailable')
      return 'Local Live requires DEMO_LOCAL_SERVER_KEY=1 and an authenticated loopback development server. Check the local setup before reconnecting.';
    if (error.status === 401 || error.code === 'missing_key')
      return 'Live could not use this API key. Update the key, then reconnect.';
    if (error.status === 403 || error.status === 404)
      return 'This project needs access to the Live and Responses models. Check model access, then reconnect.';
    if (error.status === 429)
      return 'Live reached a quota or rate limit. Check your project limits before reconnecting.';
  }
  return 'Live could not connect. Check microphone permission, network, and model access, then reconnect. No automatic retry was started.';
}
