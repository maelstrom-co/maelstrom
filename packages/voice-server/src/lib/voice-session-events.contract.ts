import type {
  SpeechChunk,
  SttCircuitStatus,
  TranscriptionResult,
  VADEvent,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionState,
} from './types.js';

export type VoiceSessionListenerRegistry = {
  stateChange: Set<(state: VoiceSessionState) => void>;
  sttCircuitStatusChange: Set<(status: SttCircuitStatus) => void>;
  transcript: Set<(result: TranscriptionResult) => void>;
  vad: Set<(event: VADEvent) => void>;
  audioOutput: Set<(chunk: SpeechChunk) => void>;
  audioDropped: Set<(event: VoiceSessionAudioDroppedEvent) => void>;
};

export interface VoiceSessionEventBus {
  onAudioDropped(
    callback: (event: VoiceSessionAudioDroppedEvent) => void,
  ): () => void;
  onAudioOutput(callback: (chunk: SpeechChunk) => void): () => void;
  onSttCircuitStatusChange(
    callback: (status: SttCircuitStatus) => void,
    getCurrentStatus: () => SttCircuitStatus,
  ): () => void;
  onTranscript(callback: (result: TranscriptionResult) => void): () => void;
  onVADEvent(callback: (event: VADEvent) => void): () => void;
  onVoiceStateChange(callback: (state: VoiceSessionState) => void): () => void;
}

export interface VoiceSessionEventSink {
  emitAudioDropped(event: VoiceSessionAudioDroppedEvent): void;
  emitAudioOutput(chunk: SpeechChunk): number;
  emitSttCircuitStatusChange(status: SttCircuitStatus): void;
  emitTranscript(
    result: TranscriptionResult,
    options: { includeCallback: boolean },
  ): number;
  emitVADEvent(event: VADEvent): void;
  emitVoiceStateChange(state: VoiceSessionState): void;
}
