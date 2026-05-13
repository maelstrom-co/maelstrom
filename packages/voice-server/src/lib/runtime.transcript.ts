import type {
  VoiceRuntimeListeners,
  VoiceRuntimeState,
} from './runtime.state.js';
import type { TranscriptionResult, VoiceSessionCallbacks } from './types.js';

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

type EmitFinalTranscriptDeps = {
  clearPendingFinalization: (state: VoiceRuntimeState) => void;
  finalizeTranscript: (text: string) => {
    emitted: boolean;
    startedProcessing: boolean;
  };
  startTranscriptGrace: () => void;
};

export function clearPendingFinalization(state: VoiceRuntimeState) {
  // WHY: Every new speech_start, manual stop, or completed finalization must cancel the old debounce
  // timer so stale VAD boundaries cannot finalize a newer turn.
  state.pendingFinalFromVAD = false;
  if (state.vadFinalDebounceTimeout) {
    clearTimeout(state.vadFinalDebounceTimeout);
    state.vadFinalDebounceTimeout = null;
  }
  if (state.transcriptGraceTimeout) {
    clearTimeout(state.transcriptGraceTimeout);
    state.transcriptGraceTimeout = null;
  }
}

export function resetTurnTracking(state: VoiceRuntimeState) {
  // WHY: Turn assembly state must reset as one unit before listening resumes, otherwise stale text
  // from a previous utterance could leak into the next provider-final or VAD-final result.
  state.suppressIncomingAudio = false;
  state.hasSentAudioForTurn = false;
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
  // WHY: The normal late-transcript path is `handleSTTEvent` -> `updateTranscriptState`/
  // `emitFinalTranscript` -> `startTranscriptGrace` -> grace-expiry finalization, but manual-stop
  // and direct VAD-finalization can also race for the same utterance. `hasEmittedFinal` is
  // load-bearing: once one path wins, every later path becomes a no-op so callbacks, grace
  // handling, and intent processing still run exactly once.
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
  deps: EmitFinalTranscriptDeps,
) {
  const { clearPendingFinalization, finalizeTranscript, startTranscriptGrace } =
    deps;
  const transcriptToFinalize = state.currentTranscript;

  if (!transcriptToFinalize && !state.hasEmittedFinal) {
    // WHY: Short utterances can hit VAD end before the STT provider flushes its final transcript.
    // The grace window absorbs that race so the normal late-arriving transcript can still finalize
    // on the delayed path instead of forcing an immediate idle fallback. The
    // `!state.hasEmittedFinal` conjunct is load-bearing: a provider-final can race the VAD debounce
    // and close the turn just before this point, and without that guard we would arm a redundant
    // grace timer on an already-finalized turn.
    startTranscriptGrace();
    return;
  }

  clearPendingFinalization(state);
  finalizeTranscript(transcriptToFinalize);
}
