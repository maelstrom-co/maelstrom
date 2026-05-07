import type { VoiceRuntimeState } from './runtime.state.js';
import type {
  AudioChunk,
  VoiceSessionAudioDropReason,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionState,
} from './types.js';

export const defaultAudioDropDebounceMs = 100;

export interface HandleNonListeningAudioChunkDropOptions {
  state: VoiceRuntimeState;
  voiceState: VoiceSessionState;
  chunk: AudioChunk;
  measureAudioChunkDurationMs: (chunk: AudioChunk) => number;
  normalizeError: (error: unknown) => Error;
  trace: (event: string, details?: Record<string, unknown>) => void;
  emitPendingAudioDropEvent: (event: VoiceSessionAudioDroppedEvent) => void;
  reportError: (error: Error) => void;
}

export function addPendingDroppedDuration(
  state: VoiceRuntimeState,
  reason: VoiceSessionAudioDropReason,
  droppedDurationMs: number,
): VoiceRuntimeState['pendingAudioDropEvent'] | null {
  if (droppedDurationMs <= 0) {
    return null;
  }

  const previousEvent = state.pendingAudioDropEvent;

  if (previousEvent && previousEvent.reason !== reason) {
    clearPendingAudioDropDebounceTimeout(state);
    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason,
      droppedDurationMs,
    };
    return previousEvent;
  }

  state.pendingAudioDropEvent = previousEvent
    ? {
        ...previousEvent,
        droppedDurationMs: previousEvent.droppedDurationMs + droppedDurationMs,
      }
    : {
        type: 'audio_dropped',
        reason,
        droppedDurationMs,
      };

  return null;
}

function clearPendingAudioDropDebounceTimeout(state: VoiceRuntimeState) {
  if (state.pendingAudioDropDebounceTimeout) {
    clearTimeout(state.pendingAudioDropDebounceTimeout);
    state.pendingAudioDropDebounceTimeout = null;
  }
}

export function handleNonListeningAudioChunkDrop(
  options: HandleNonListeningAudioChunkDropOptions,
) {
  const {
    state,
    voiceState,
    chunk,
    measureAudioChunkDurationMs,
    normalizeError,
    trace,
    emitPendingAudioDropEvent,
    reportError,
  } = options;

  const error = new Error(
    `Cannot accept audio chunk while voice session is ${voiceState}`,
  );

  try {
    const droppedDurationMs = measureAudioChunkDurationMs(chunk);
    if (Number.isFinite(droppedDurationMs) && droppedDurationMs > 0) {
      const replacedPendingDropEvent = addPendingDroppedDuration(
        state,
        'state_not_listening',
        droppedDurationMs,
      );
      if (replacedPendingDropEvent) {
        emitPendingAudioDropEvent(replacedPendingDropEvent);
      }
      schedulePendingAudioDropNotification(state, emitPendingAudioDropEvent);
    }
  } catch (durationError) {
    const normalizedDurationError = normalizeError(durationError);
    error.cause = normalizedDurationError;
    trace('stt.audio.dropped.duration_unavailable', {
      bytes: chunk.data.length,
      sampleRate: chunk.sampleRate,
      encoding: chunk.encoding,
      state: voiceState,
      message: normalizedDurationError.message,
    });
  }

  trace('stt.audio.dropped', {
    bytes: chunk.data.length,
    sampleRate: chunk.sampleRate,
    encoding: chunk.encoding,
    state: voiceState,
    message: error.message,
  });

  reportError(error);
}

export function discardPendingAudioDropEvent(state: VoiceRuntimeState) {
  clearPendingAudioDropDebounceTimeout(state);
  state.pendingAudioDropEvent = null;
}

export function schedulePendingAudioDropNotification(
  state: VoiceRuntimeState,
  emitAudioDropped: (event: VoiceSessionAudioDroppedEvent) => void,
) {
  if (!state.pendingAudioDropEvent || state.pendingAudioDropDebounceTimeout) {
    return;
  }

  state.pendingAudioDropDebounceTimeout = setTimeout(() => {
    state.pendingAudioDropDebounceTimeout = null;

    if (state.destroyed || !state.pendingAudioDropEvent) {
      return;
    }

    const event = state.pendingAudioDropEvent;
    state.pendingAudioDropEvent = null;
    emitAudioDropped(event);
  }, defaultAudioDropDebounceMs);
}

export function flushPendingAudioDropEvent(
  state: VoiceRuntimeState,
  emitAudioDropped: (event: VoiceSessionAudioDroppedEvent) => void,
) {
  clearPendingAudioDropDebounceTimeout(state);

  if (state.destroyed || !state.pendingAudioDropEvent) {
    state.pendingAudioDropEvent = null;
    return;
  }

  const event = state.pendingAudioDropEvent;
  state.pendingAudioDropEvent = null;
  emitAudioDropped(event);
}
