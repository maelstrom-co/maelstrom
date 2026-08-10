// Wire constants shared by the browser adapter and the agent worker. Zero
// imports on purpose: the worker reaches these through
// `@maelstrom-co/realtime-protocol/livekit-wire`, which must never pull in
// browser or server dependencies — not even zod. This is the single source of
// truth both sides read so the topic strings can never drift.

/** Text-stream topic the client uses to send TTS requests to the worker. */
export const SPEAK_TOPIC = 'speak';

/**
 * Identity the browser client connects to the room with, and the identity the
 * worker waits for on join and filters incoming tracks against. A room-wide
 * constant (not per-session) because the spike supports exactly one human
 * participant per room.
 */
export const USER_PARTICIPANT_IDENTITY = 'user';

/**
 * Data topic for client→worker turn control: `turn_end` (flush the STT buffer)
 * and `tts_cancel` (barge-in — abort the in-flight TTS so old audio stops).
 */
export const TURN_TOPIC = 'turn';

/**
 * Data topic the worker uses to report TTS status back to the client: a
 * `tts_done` when playout of a summary finishes (so the client can collapse
 * `speaking`→`connected` on actual audio end, not on text hand-off), or a
 * `tts_error` when synthesis fails.
 */
export const TTS_TOPIC = 'tts';

/**
 * Attribute key carrying the utterance id on a `SPEAK_TOPIC` text stream. The
 * client (which initiates each utterance) stamps a monotonic id here; the worker
 * echoes it on the matching `TTS_TOPIC` status packet ({@link TtsDoneMessage} /
 * {@link TtsErrorMessage}) so the client can drop status for an utterance it has
 * already barged past — a cancelled utterance's late `tts_done` must not clear
 * the client's thinking fallback or move state, or the UI wedges in `thinking`.
 */
export const SPEAK_UTTERANCE_ID_ATTR = 'mae-utterance-id';

/** Sent browser adapter → worker on the `TURN_TOPIC` to flush the STT buffer. */
export interface TurnEndMessage {
  type: 'turn_end';
}

/**
 * Sent browser adapter → worker on the `TURN_TOPIC` when the user barges in
 * while the assistant is speaking: aborts the in-flight Cartesia TTS so the
 * queued audio stops near-instantly instead of playing to completion.
 */
export interface TtsCancelMessage {
  type: 'tts_cancel';
}

/** Sent worker → browser adapter on the `TTS_TOPIC` when TTS synthesis fails. */
export interface TtsErrorMessage {
  type: 'tts_error';
  /**
   * The utterance this status refers to, echoed from the speak request's
   * {@link SPEAK_UTTERANCE_ID_ATTR}. Absent when the worker never received an id
   * (older/id-less speak requests); the client then falls back to type-only
   * handling.
   */
  utteranceId?: number;
}

/** Sent worker → browser adapter on the `TTS_TOPIC` when TTS playout finishes. */
export interface TtsDoneMessage {
  type: 'tts_done';
  /** The utterance this status refers to — see {@link TtsErrorMessage.utteranceId}. */
  utteranceId?: number;
}
