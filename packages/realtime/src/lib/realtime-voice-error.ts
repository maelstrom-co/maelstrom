import { MaelstromError } from '@maelstrom-co/protocol';

/**
 * Programmatic causes for realtime voice failures. UIs switch on these to
 * show actionable recovery guidance (e.g. mic-permission help vs. key setup).
 */
export type RealtimeVoiceErrorCode =
  | 'MIC_PERMISSION_DENIED'
  | 'TOKEN_MINT_FAILED'
  | 'CONNECTION_FAILED'
  | 'DATA_CHANNEL_ERROR'
  | 'ALREADY_CONNECTED'
  // Raised on a connect() attempt that a newer connect()/teardown overtook
  // while it was mid-handshake — the stale attempt aborts instead of clobbering
  // the winning attempt's connection.
  | 'CONNECT_SUPERSEDED';

/**
 * A realtime voice failure with a typed cause.
 *
 * Thrown from `connect()` for setup failures and carried on adapter `error`
 * events for in-session failures. `instanceof RealtimeVoiceError` is the
 * supported way to distinguish fatal voice errors from benign noise —
 * consumers must never string-match messages.
 */
export class RealtimeVoiceError extends MaelstromError {
  public override readonly code: RealtimeVoiceErrorCode;

  constructor(code: RealtimeVoiceErrorCode, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'RealtimeVoiceError';
    this.code = code;
  }
}
