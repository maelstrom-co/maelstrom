import type {
  VoiceRuntimeListeners,
  VoiceRuntimeState,
} from './runtime.state.js';
import type {
  TranscriptionResult,
  VoiceSessionCallbacks,
  VoiceSessionState,
} from './types.js';

type NotifyListenersSafely = <T>(
  listeners: Set<(value: T) => void>,
  value: T,
  traceEvent: string,
) => void;

type NotifyCallbackSafely = <T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  traceEvent: string,
  ...args: T
) => void;

export function clearPendingFinalization(state: VoiceRuntimeState) {
  // WHY: Every new speech_start, manual stop, or completed finalization must cancel the old debounce
  // timer so stale VAD boundaries cannot finalize a newer turn.
  state.pendingFinalFromVAD = false;
  if (state.vadFinalDebounceTimeout) {
    clearTimeout(state.vadFinalDebounceTimeout);
    state.vadFinalDebounceTimeout = null;
  }
}

export function resetTurnTracking(state: VoiceRuntimeState) {
  // WHY: Turn assembly state must reset as one unit before listening resumes, otherwise stale text
  // from a previous utterance could leak into the next provider-final or VAD-final result.
  state.hasReceivedSpeech = false;
  state.hasEmittedFinal = false;
  state.currentTranscript = '';
  state.accumulatedTranscript = '';
  clearPendingFinalization(state);
}

export function updateTranscriptState(
  state: VoiceRuntimeState,
  result: TranscriptionResult,
) {
  if (result.isFinal) {
    // WHY: Provider-final fragments are accumulated even though the runtime does not expose them as
    // final yet. This preserves vendor segmentation while still letting client VAD remain the only
    // outward-facing turn boundary.
    state.hasReceivedSpeech = true;
    state.accumulatedTranscript = state.accumulatedTranscript
      ? `${state.accumulatedTranscript} ${result.text}`
      : result.text;
    state.currentTranscript = state.accumulatedTranscript;
    return;
  }

  state.currentTranscript = state.accumulatedTranscript
    ? `${state.accumulatedTranscript} ${result.text}`
    : result.text;
}

export function createForwardedTranscriptResult(
  state: VoiceRuntimeState,
  result: TranscriptionResult,
): TranscriptionResult {
  // WHY: The client owns VAD turn boundaries. Provider `isFinal` (e.g. Deepgram's `is_final`
  // from its own endpointing/`utterance_end_ms`) is still used internally by
  // `updateTranscriptState` to merge fragments, but it must never leak outward as a final
  // transcript before the client emits `vad_end`/`utterance_end`. Only the VAD-driven
  // `finalizeTranscript` path is allowed to emit `isFinal: true` to listeners.
  return {
    text: state.currentTranscript,
    isFinal: false,
    confidence: result.confidence,
    language: result.language,
    durationInSeconds: result.durationInSeconds,
  };
}

export function forwardTranscriptResult(
  listeners: VoiceRuntimeListeners,
  callbacks: VoiceSessionCallbacks,
  notifyListenersSafely: NotifyListenersSafely,
  notifyCallbackSafely: NotifyCallbackSafely,
  trace: (event: string, details?: Record<string, unknown>) => void,
  interimResults: boolean,
  result: TranscriptionResult,
) {
  // WHY: Listener subscriptions are a lower-level observability surface, so they always see the
  // forwarded transcript event. The optional callback keeps its historical behavior and can suppress
  // interim noise when the host only wants stable user-visible updates.
  notifyListenersSafely(
    listeners.transcript,
    result,
    'callback.onTranscriptListener.failed',
  );
  trace('stt.transcript.forwarded', {
    textLength: result.text.length,
    preview: result.text.slice(0, 80),
    isFinal: result.isFinal,
    listenerCount: listeners.transcript.size,
    hasOnTranscriptCallback: Boolean(callbacks.onTranscript),
  });
  if (interimResults || result.isFinal) {
    notifyCallbackSafely(
      callbacks.onTranscript,
      'callback.onTranscript.failed',
      result,
    );
  }
}

export function finalizeTranscript(
  state: VoiceRuntimeState,
  listeners: VoiceRuntimeListeners,
  callbacks: VoiceSessionCallbacks,
  notifyListenersSafely: NotifyListenersSafely,
  notifyCallbackSafely: NotifyCallbackSafely,
  processTranscript: (text: string) => boolean,
  text: string,
): {
  emitted: boolean;
  startedProcessing: boolean;
} {
  // WHY: A single utterance can reach finalization from both provider-final and VAD-end paths.
  // Once one path wins, the other must become a no-op so transcript callbacks and intent work run once.
  if (!text || state.hasEmittedFinal) {
    return { emitted: false, startedProcessing: false };
  }

  state.hasEmittedFinal = true;
  state.hasReceivedSpeech = true;
  state.currentTranscript = text;
  state.accumulatedTranscript = text;

  const finalResult: TranscriptionResult = {
    text,
    isFinal: true,
  };
  notifyListenersSafely(
    listeners.transcript,
    finalResult,
    'callback.onTranscriptListener.failed',
  );
  notifyCallbackSafely(
    callbacks.onTranscript,
    'callback.onTranscript.failed',
    finalResult,
  );

  return {
    emitted: true,
    startedProcessing: processTranscript(text),
  };
}

export function emitFinalTranscript(
  state: VoiceRuntimeState,
  clearPendingFinalizationFn: (state: VoiceRuntimeState) => void,
  finalizeTranscriptFn: (text: string) => {
    emitted: boolean;
    startedProcessing: boolean;
  },
  reportError: (error: unknown) => void,
  setVoiceState: (state: VoiceSessionState) => void,
) {
  if (!state.currentTranscript && !state.hasEmittedFinal) {
    // WHY: A VAD end without any transcript is almost always a broken upstream contract, either from
    // an over-eager client VAD or a provider that never flushed text. Surfacing it helps diagnose
    // silent-turn bugs instead of pretending an empty utterance was valid.
    clearPendingFinalizationFn(state);
    reportError(
      new Error('VAD ended the utterance before a transcript was available'),
    );
    setVoiceState('idle');
    return;
  }

  clearPendingFinalizationFn(state);
  finalizeTranscriptFn(state.currentTranscript);
}
