export interface VADModelConfig {
  modelPath?: string;
  sampleRate?: 16000;
  threshold?: number; // Speech probability threshold (default: 0.7)
  silenceThresholdMs?: number; // Silence duration to end speech (default: 500)
  speechThresholdMs?: number; // Min speech duration to be valid (default: 50)
  windowSizeMs?: number; // Window size in ms (default: 32)
}

/** User-facing VAD configuration — alias for VADStreamOptions */
export type { VADStreamOptions as VADConfig } from './vad-processor.js';

/**
 * VAD event emitted when speech boundaries are detected.
 */
export interface VADEvent {
  type: 'speech_start' | 'speech_end';
  /** Sample index when the speech/silence actually started */
  sampleIndex: number;
  /** Sample index when the decision was made (after threshold duration) */
  decidedAtSampleIndex: number;
  /** Time offset from stream start */
  offsetMs: number;
  /** Speech probability at decision time */
  probability: number;
}

export type VADState =
  | 'uninitialized'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'listening'
  | 'error';

export interface VADEvents {
  // Called when the speech segment is detected to have started
  // Notice that this is called at the moment speech is detected,
  // but the real segment is aggregated internally based on the thresholds and durations configured
  // bufferedSinceFirstProb is the audio buffered since the first time the probability crossed the threshold, so it includes pre-buffered audio and any audio during the threshold duration
  onSpeechStart: (event: VADEvent, bufferedSinceFirstProb: Uint8Array) => void;

  // Called when speech is detected to have ended, with the duration of the speech in milliseconds
  // if event is null, that means that the VAD processor is closed
  onSpeechEnd: (event: VADEvent | null, durationMs: number) => void;

  // Called with the current speech segment probability (0 to 1) whenever it is updated
  // Notice that this is per small chunk
  // The real segment is aggregated internally based on the thresholds and durations configured
  onSpeechProbability: (probability: number) => void;

  // Called if there is an error loading the model or during processing
  onError: (error: Error) => void;

  // Called whenever the internal state of the VAD changes (e.g. from 'idle' to 'listening')
  onStateChange: (state: VADState) => void;
}
