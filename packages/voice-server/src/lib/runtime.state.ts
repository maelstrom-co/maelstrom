import type {
  AudioChunk,
  SpeakParams,
  SpeechChunk,
  SttCircuitStatus,
  TranscriptionResult,
  VADEvent,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionAudioDropReason,
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
  /**
   * FIFO queue of speech turns waiting to start after the current active turn completes.
   *
   * Cleared on `interrupt()`, replacement `speak()`, `destroy()`, and when a new
   * intent-processing request preempts active or pending speech through `executeIntentRequest()`.
   * Also drained when `dispatchSpeak()`'s `ensureTTSConnected()` rejects on the cold path.
   */
  speakQueue: Array<SpeakParams>;
  currentTranscript: string;
  hasSentAudioForTurn: boolean;
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
  suppressIncomingAudio: boolean;
  vadFinalDebounceTimeout: ReturnType<typeof setTimeout> | null;
  transcriptGraceTimeout: ReturnType<typeof setTimeout> | null;
  consecutiveGraceExpiries: number;
  hasEmittedFinal: boolean;
  activeProcessAbortController: AbortController | null;
  suppressNextAutoRestart: boolean;
  reconnectAttempts: number;
  reconnectPromise: Promise<void> | null;
  reconnectResetTimeout: ReturnType<typeof setTimeout> | null;
  sttCircuitStatus: SttCircuitStatus;
  sttCircuitOpenedAt: number | null;
  sttCircuitCooldownTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Internal listener sets used by the runtime implementation.
 *
 * WHY: These listeners mirror the public subscription API, but they stay internal so the runtime can
 * guarantee safe fan-out and cleanup without exposing mutable sets to callers.
 */
export interface VoiceRuntimeListeners {
  stateChange: Set<(state: VoiceSessionState) => void>;
  sttCircuitStatusChange: Set<(status: SttCircuitStatus) => void>;
  transcript: Set<(result: TranscriptionResult) => void>;
  vad: Set<(event: VADEvent) => void>;
  audioOutput: Set<(chunk: SpeechChunk) => void>;
  audioDropped: Set<(event: VoiceSessionAudioDroppedEvent) => void>;
}

export function createInitialVoiceRuntimeState(): VoiceRuntimeState {
  return {
    state: 'idle',
    destroyed: false,
    speakQueue: [],
    currentTranscript: '',
    hasSentAudioForTurn: false,
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
    suppressIncomingAudio: false,
    vadFinalDebounceTimeout: null,
    transcriptGraceTimeout: null,
    consecutiveGraceExpiries: 0,
    hasEmittedFinal: false,
    activeProcessAbortController: null,
    suppressNextAutoRestart: false,
    reconnectAttempts: 0,
    reconnectPromise: null,
    reconnectResetTimeout: null,
    sttCircuitStatus: 'closed',
    sttCircuitOpenedAt: null,
    sttCircuitCooldownTimeout: null,
  };
}

export function createVoiceRuntimeListeners(): VoiceRuntimeListeners {
  return {
    stateChange: new Set(),
    sttCircuitStatusChange: new Set(),
    transcript: new Set(),
    vad: new Set(),
    audioOutput: new Set(),
    audioDropped: new Set(),
  };
}
