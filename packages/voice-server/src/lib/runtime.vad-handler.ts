import type { VADEvent, VoiceSessionCallbacks } from './types.js';
import type {
  VoiceRuntimeListeners,
  VoiceRuntimeState,
} from './runtime.state.js';

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

export function handleVADEvent(
  state: VoiceRuntimeState,
  listeners: VoiceRuntimeListeners,
  callbacks: VoiceSessionCallbacks,
  vadFinalDebounceMs: number,
  trace: (event: string, details?: Record<string, unknown>) => void,
  notifyListenersSafely: NotifyListenersSafely,
  notifyCallbackSafely: NotifyCallbackSafely,
  clearPendingFinalization: () => void,
  emitFinalTranscript: () => void,
  event: VADEvent,
) {
  trace('vad.event', {
    type: event.type,
    timestamp: event.timestamp,
    durationMs: event.durationMs ?? null,
  });
  notifyListenersSafely(
    listeners.vad,
    event,
    'callback.onVADEventListener.failed',
  );
  notifyCallbackSafely(
    callbacks.onVADEvent,
    'callback.onVADEvent.failed',
    event,
  );

  if (event.type === 'speech_end' || event.type === 'utterance_end') {
    // WHY: End-of-speech is debounced because client VAD and provider transcript flushing are not
    // perfectly simultaneous. The short wait gives STT one last chance to deliver text before the
    // runtime commits the turn boundary.
    state.pendingFinalFromVAD = true;
    if (state.vadFinalDebounceTimeout) {
      clearTimeout(state.vadFinalDebounceTimeout);
    }
    state.vadFinalDebounceTimeout = setTimeout(() => {
      if (state.pendingFinalFromVAD) {
        emitFinalTranscript();
      }
    }, vadFinalDebounceMs);
  }

  if (event.type === 'speech_start') {
    // WHY: A new speech_start cancels any pending finalize from the previous silence gap, which is
    // what allows barge-in and brief pauses without chopping a single utterance into two turns.
    clearPendingFinalization();
  }
}
