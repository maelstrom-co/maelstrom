import type {
  AudioChunk,
  SpeechChunk,
  TranscriptionResult,
  VoiceSessionAudioDropReason,
  VoiceSessionAudioDroppedEvent,
  VADEvent,
  VoiceSessionState,
} from './types.js';

export interface BufferedAudioChunk {
  chunk: AudioChunk;
  durationMs: number;
  bufferingReason: VoiceSessionAudioDropReason;
}

/**
 * Internal mutable state for a live voice session.
 *
 * WHY: The runtime helpers share one state bag on purpose. Turn-taking, reconnects, buffering, and
 * cancellation all need to coordinate on the same mutable facts, and splitting them into isolated
 * stores would make those ordering guarantees harder to preserve.
 */
export interface VoiceRuntimeState {
  state: VoiceSessionState;
  destroyed: boolean;
  currentTranscript: string;
  hasReceivedSpeech: boolean;
  sttUnsubscribe: (() => void) | null;
  ttsUnsubscribe: (() => void) | null;
  autoRestartTimeout: ReturnType<typeof setTimeout> | null;
  isInitializing: boolean;
  startListeningPromise: Promise<void> | null;
  pendingAudioChunks: BufferedAudioChunk[];
  pendingAudioDurationMs: number;
  pendingAudioDropEvent: VoiceSessionAudioDroppedEvent | null;
  pendingAudioDropDebounceTimeout: ReturnType<typeof setTimeout> | null;
  accumulatedTranscript: string;
  pendingFinalFromVAD: boolean;
  vadFinalDebounceTimeout: ReturnType<typeof setTimeout> | null;
  hasEmittedFinal: boolean;
  activeProcessAbortController: AbortController | null;
  suppressNextAutoRestart: boolean;
  reconnectAttempts: number;
  reconnectPromise: Promise<void> | null;
  reconnectResetTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Internal listener sets used by the runtime implementation.
 *
 * WHY: These listeners mirror the public subscription API, but they stay internal so the runtime can
 * guarantee safe fan-out and cleanup without exposing mutable sets to callers.
 */
export interface VoiceRuntimeListeners {
  stateChange: Set<(state: VoiceSessionState) => void>;
  transcript: Set<(result: TranscriptionResult) => void>;
  vad: Set<(event: VADEvent) => void>;
  audioOutput: Set<(chunk: SpeechChunk) => void>;
  audioDropped: Set<(event: VoiceSessionAudioDroppedEvent) => void>;
}

export function createInitialVoiceRuntimeState(): VoiceRuntimeState {
  return {
    state: 'idle',
    destroyed: false,
    currentTranscript: '',
    hasReceivedSpeech: false,
    sttUnsubscribe: null,
    ttsUnsubscribe: null,
    autoRestartTimeout: null,
    isInitializing: false,
    startListeningPromise: null,
    pendingAudioChunks: [],
    pendingAudioDurationMs: 0,
    pendingAudioDropEvent: null,
    pendingAudioDropDebounceTimeout: null,
    accumulatedTranscript: '',
    pendingFinalFromVAD: false,
    vadFinalDebounceTimeout: null,
    hasEmittedFinal: false,
    activeProcessAbortController: null,
    suppressNextAutoRestart: false,
    reconnectAttempts: 0,
    reconnectPromise: null,
    reconnectResetTimeout: null,
  };
}

export function createVoiceRuntimeListeners(): VoiceRuntimeListeners {
  return {
    stateChange: new Set(),
    transcript: new Set(),
    vad: new Set(),
    audioOutput: new Set(),
    audioDropped: new Set(),
  };
}
