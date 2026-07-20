// Wire constants shared by the browser adapter and the agent worker. Zero
// imports on purpose: the worker's `./protocol` import must never pull in
// browser or server dependencies, and this is the single source of truth both
// sides read so the topic strings can never drift.

/** Text-stream topic the client uses to send TTS requests to the worker. */
export const SPEAK_TOPIC = 'speak';

/** Data topic the client uses to signal end-of-turn (flush the STT buffer). */
export const TURN_TOPIC = 'turn';

/**
 * Data topic the worker uses to report TTS status back to the client: a
 * `tts_done` when playout of a summary finishes (so the client can collapse
 * `speaking`→`connected` on actual audio end, not on text hand-off), or a
 * `tts_error` when synthesis fails.
 */
export const TTS_TOPIC = 'tts';

export interface TurnEndMessage {
  type: 'turn_end';
}

export interface TtsErrorMessage {
  type: 'tts_error';
}

export interface TtsDoneMessage {
  type: 'tts_done';
}
