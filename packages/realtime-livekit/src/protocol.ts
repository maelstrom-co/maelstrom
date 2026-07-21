// Wire constants shared by the browser adapter and the agent worker. Zero
// imports on purpose: the worker's `./protocol` import must never pull in
// browser or server dependencies, and this is the single source of truth both
// sides read so the topic strings can never drift.

/** Text-stream topic the client uses to send TTS requests to the worker. */
export const SPEAK_TOPIC = 'speak';

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
}

/** Sent worker → browser adapter on the `TTS_TOPIC` when TTS playout finishes. */
export interface TtsDoneMessage {
  type: 'tts_done';
}
