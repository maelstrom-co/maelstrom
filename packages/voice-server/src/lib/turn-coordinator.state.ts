import type { VoiceSessionState } from './types.js';

export type TurnCoordinatorState = {
  state: VoiceSessionState;
  autoRestartTimeout: ReturnType<typeof setTimeout> | null;
  currentTranscript: string;
  hasSentAudioForTurn: boolean;
  hasReceivedSpeech: boolean;
  accumulatedTranscript: string;
  suppressIncomingAudio: boolean;
  transcriptGraceTimeout: ReturnType<typeof setTimeout> | null;
  consecutiveGraceExpiries: number;
  hasEmittedFinal: boolean;
  activeProcessAbortController: AbortController | null;
  suppressNextAutoRestart: boolean;
};

export function createInitialTurnCoordinatorState(): TurnCoordinatorState {
  return {
    state: 'idle',
    autoRestartTimeout: null,
    currentTranscript: '',
    hasSentAudioForTurn: false,
    hasReceivedSpeech: false,
    accumulatedTranscript: '',
    suppressIncomingAudio: false,
    transcriptGraceTimeout: null,
    consecutiveGraceExpiries: 0,
    hasEmittedFinal: false,
    activeProcessAbortController: null,
    suppressNextAutoRestart: false,
  };
}
