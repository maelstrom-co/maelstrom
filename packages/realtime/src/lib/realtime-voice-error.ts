import { MaelstromError } from '@maelstrom-co/protocol';

/**
 * Programmatic causes for realtime voice failures. UIs switch on these to
 * show actionable recovery guidance (e.g. mic-permission help vs. key setup).
 *
 * Every code names a **fatal** condition: a code exists only for failures that
 * warrant raising a {@link RealtimeVoiceError}, which by contract tears the
 * session down. Non-fatal failures carry no code — see the severity contract
 * on {@link RealtimeVoiceError}.
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
 *
 * ## Severity contract
 *
 * A `RealtimeVoiceError` is the **fatal** signal, and this is its load-bearing
 * invariant: raising one — thrown from `connect()`, or emitted on an adapter
 * `error` event — tells `RealtimeSession` the session can no longer function,
 * so it tears the connection down and enters the `error` state. A plain
 * `Error` on an `error` event is only logged. Adapters must therefore reserve
 * `RealtimeVoiceError` for genuinely fatal conditions:
 *
 * - **Fatal** (raise a `RealtimeVoiceError`) — the session is unusable: a lost
 *   tool result (the model conversation wedges without it), or loss of the
 *   underlying connection (token mint failure, transport/mic failure while
 *   connecting, a broken data channel the session drives turns over).
 * - **Non-fatal** (never raise a `RealtimeVoiceError`) — a failure that leaves
 *   the already-applied UI change intact and the session usable: a
 *   worker-reported TTS synthesis failure or a malformed status packet on the
 *   spoken read-back channel (the `update_ui` already rendered; only its voiced
 *   confirmation was lost), or an unrecognized inbound packet. Raising a fatal
 *   error here would kill a live session over lost audio. Instead warn once and
 *   recover locally (e.g. collapse a transient `speaking` state so the UI does
 *   not hang waiting for audio that will never arrive).
 */
export class RealtimeVoiceError extends MaelstromError {
  public override readonly code: RealtimeVoiceErrorCode;

  constructor(code: RealtimeVoiceErrorCode, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'RealtimeVoiceError';
    this.code = code;
  }
}
