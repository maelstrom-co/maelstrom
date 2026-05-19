import type { BufferedAudioChunk } from './audio-buffer-queue.js';
import type { VoiceSessionAudioDroppedEvent } from './types.js';

export type AudioBufferQueueState = {
  pendingAudioChunks: BufferedAudioChunk[];
  pendingAudioDurationMs: number;
  pendingAudioDropEvent: VoiceSessionAudioDroppedEvent | null;
  pendingAudioDropDebounceTimeout: ReturnType<typeof setTimeout> | null;
};

export function createInitialAudioBufferQueueState(): AudioBufferQueueState {
  return {
    pendingAudioChunks: [],
    pendingAudioDurationMs: 0,
    pendingAudioDropEvent: null,
    pendingAudioDropDebounceTimeout: null,
  };
}
