import { createInitialVADCoordinatorState } from './vad-coordinator.state.js';
import type { VADEvent } from './types.js';

type VADCoordinatorDependencies = {
  vadFinalDebounceMs: number;
  trace: (event: string, details?: Record<string, unknown>) => void;
  emitVADEvent: (event: VADEvent) => void;
  clearPendingFinalization: () => void;
  emitFinalTranscript: () => void;
};

export function createVADCoordinator(dependencies: VADCoordinatorDependencies) {
  const state = createInitialVADCoordinatorState();

  function clearPendingFinalization() {
    state.pendingFinalFromVAD = false;
    if (state.vadFinalDebounceTimeout) {
      clearTimeout(state.vadFinalDebounceTimeout);
      state.vadFinalDebounceTimeout = null;
    }
  }

  function handleVADEvent(event: VADEvent) {
    dependencies.trace('vad.event', {
      type: event.type,
      timestamp: event.timestamp,
      durationMs: event.durationMs ?? null,
    });
    dependencies.emitVADEvent(event);

    if (event.type === 'speech_end' || event.type === 'utterance_end') {
      state.pendingFinalFromVAD = true;
      if (state.vadFinalDebounceTimeout) {
        clearTimeout(state.vadFinalDebounceTimeout);
      }
      state.vadFinalDebounceTimeout = setTimeout(() => {
        if (state.pendingFinalFromVAD) {
          state.vadFinalDebounceTimeout = null;
          dependencies.emitFinalTranscript();
        }
      }, dependencies.vadFinalDebounceMs);
    }

    if (event.type === 'speech_start') {
      dependencies.clearPendingFinalization();
      clearPendingFinalization();
    }
  }

  function destroy() {
    clearPendingFinalization();
  }

  function setPendingFinalFromVAD(value: boolean) {
    state.pendingFinalFromVAD = value;
  }

  return {
    clearPendingFinalization,
    destroy,
    handleVADEvent,
    isPendingFinalFromVAD: () => state.pendingFinalFromVAD,
    setPendingFinalFromVAD,
  };
}
