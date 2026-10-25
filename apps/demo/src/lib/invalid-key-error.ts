import { WireEngineError } from '@maelstrom-co/client';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';

/**
 * True for a text-path (chart_request) failure caused by a rejected OpenAI
 * key, the browser-key analogue of the voice path's TOKEN_MINT_FAILED. The
 * wire error's `code` is the engine's `ProviderError._tag`, which covers
 * every LLM-adapter failure (network, rate limit, bad key). The message text
 * is what actually narrows it to a rejected key.
 */
export function isInvalidKeyError(error: Error): boolean {
  const code = error instanceof WireEngineError ? error.code : undefined;
  if (code !== 'ProviderError') return false;
  return /\b401\b|invalid api key|incorrect api key/i.test(error.message);
}

/**
 * True when GPT-Live could not start because the browser-owned key is missing
 * or was rejected. Live mints no token, so this arrives as a connection
 * failure whose cause is the exchange's transport error.
 */
export function isLiveInvalidKeyError(
  error: unknown,
): error is RealtimeVoiceError & { readonly cause: LiveTransportError } {
  if (
    !(error instanceof RealtimeVoiceError) ||
    error.code !== 'CONNECTION_FAILED'
  ) {
    return false;
  }
  const { cause } = error;
  return (
    cause instanceof LiveTransportError &&
    (cause.status === 401 || cause.code === 'missing_key')
  );
}
