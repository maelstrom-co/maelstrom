import type { VoiceSessionListenerRegistry } from './voice-session-events.contract.js';

export type VoiceSessionEventsState = {
  destroyed: boolean;
  listeners: VoiceSessionListenerRegistry;
};

export function createInitialVoiceSessionEventsState(): VoiceSessionEventsState {
  return {
    destroyed: false,
    listeners: {
      stateChange: new Set(),
      sttCircuitStatusChange: new Set(),
      transcript: new Set(),
      vad: new Set(),
      audioOutput: new Set(),
      audioDropped: new Set(),
    },
  };
}
