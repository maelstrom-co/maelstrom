import type { VoiceError } from '@maelstrom-co/protocol-old';
import type { VoiceSessionState } from './voice-session.js';

/** Typed event map for selective subscription */
export interface VoiceEventMap {
  stateChange: (state: VoiceSessionState) => void;
  transcript: (text: string, isFinal: boolean) => void;
  error: (error: VoiceError) => void;
  audioLevel: (level: number) => void;
  response: (response: { userMessage?: string; requestId: string }) => void;
  speechStarted: (text: string) => void;
  audioOutput: (audioData: Uint8Array) => void;
  /**
   * Audio bootstrap is gated on a prior user gesture (`getUserMedia` and
   * `AudioContext.resume()` reject without one). Fires `true` when the server
   * is ready but no gesture has occurred yet, and `false` once a gesture
   * unlocks the pipeline. Consumers use this to render an explicit affordance
   * (e.g. a "tap to start" dialog) rather than landing in a silent error.
   */
  needsUserGesture: (needsGesture: boolean) => void;
  /** Discriminated union catchall — receives ALL events as a tagged union */
  event: (event: VoiceEvent) => void;
}

/** Discriminated union of all voice events (for catchall subscriber) */
export type VoiceEvent =
  | { type: 'stateChange'; state: VoiceSessionState }
  | { type: 'transcript'; text: string; isFinal: boolean }
  | { type: 'error'; error: VoiceError }
  | { type: 'audioLevel'; level: number }
  | { type: 'response'; userMessage?: string; requestId: string }
  | { type: 'speechStarted'; text: string }
  | { type: 'audioOutput'; audioData: Uint8Array }
  | { type: 'needsUserGesture'; needsGesture: boolean };
