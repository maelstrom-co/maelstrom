import type { SpeakParams } from './types.js';

export type TTSSessionManagerState = {
  ttsUnsubscribe: (() => void) | null;
  speakQueue: SpeakParams[];
  pendingDispatchGeneration: number;
  pendingDispatchCount: number;
  activeSpeechGeneration: number;
  activeSpeech: {
    generation: number;
    finished: boolean;
    firstByteTimingStartedAt: number | null;
    firstByteTimingRecorded: boolean;
    queued: boolean;
    voiceProvided?: boolean;
  };
};

export function createInitialTTSSessionManagerState(): TTSSessionManagerState {
  return {
    ttsUnsubscribe: null,
    speakQueue: [],
    pendingDispatchGeneration: 0,
    pendingDispatchCount: 0,
    activeSpeechGeneration: 0,
    activeSpeech: {
      generation: 0,
      finished: true,
      firstByteTimingStartedAt: null,
      firstByteTimingRecorded: false,
      queued: false,
    },
  };
}
