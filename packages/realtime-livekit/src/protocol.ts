// Wire constants shared by the browser adapter and the agent worker. Zero
// imports on purpose: the worker's `./protocol` import must never pull in
// browser or server dependencies, and this is the single source of truth both
// sides read so the topic strings can never drift.

/** Text-stream topic the client uses to send TTS requests to the worker. */
export const SPEAK_TOPIC = 'speak';

/** Data topic the client uses to signal end-of-turn (flush the STT buffer). */
export const TURN_TOPIC = 'turn';

/** Data topic the worker uses to report TTS errors back to the client. */
export const TTS_TOPIC = 'tts';

export interface TurnEndMessage {
  type: 'turn_end';
}

export interface TtsErrorMessage {
  type: 'tts_error';
}
