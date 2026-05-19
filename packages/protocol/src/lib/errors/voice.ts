import { MaelstromError } from './base.js';

/**
 * Discriminator for wire- and session-level voice failures surfaced via
 * {@link VoiceError}.
 *
 * Each code identifies a class of failure observable on a voice session.
 * Consumers should switch on `code` to drive remediation UI; the
 * human-readable `message` is for logging and end-user copy.
 *
 * **Note.** Client-side peer-dep failures (the `@maelstrom-co/voice`
 * package missing or failing to load) are surfaced separately via
 * `VoiceDependencyError` from `@maelstrom-co/react-voice`, since they are
 * not a wire-level concern and do not originate from a voice session.
 */
export type VoiceErrorCode =
  /** User denied microphone permission in the browser prompt. Re-prompting requires explicit user action. */
  | 'MICROPHONE_DENIED'
  /** Speech-to-text provider rejected the audio or returned an error. Inspect `cause` for provider details. */
  | 'STT_FAILED'
  /** Text-to-speech provider failed to synthesize. Inspect `cause` for provider details. */
  | 'TTS_FAILED'
  /** Underlying transport (WebSocket / signaling) dropped. Session is unusable until reconnect succeeds. */
  | 'CONNECTION_LOST'
  /** Operation exceeded the configured deadline (STT finalize, TTS synth, handshake). */
  | 'TIMEOUT'
  /** Fallback for failures that don't match a more specific code. Inspect `cause` and `message`. */
  | 'UNKNOWN';

/**
 * Typed error surfaced for wire- and session-level voice failures.
 *
 * Discriminated by {@link VoiceErrorCode}. The underlying provider /
 * transport error (if any) is preserved on `cause`; the human-readable
 * description is on `message`. Use `instanceof MaelstromError` to catch
 * this alongside other Maelstrom errors; use `instanceof VoiceError` to
 * scope to voice concerns.
 */
export class VoiceError extends MaelstromError {
  constructor(code: VoiceErrorCode, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'VoiceError';
  }
}
