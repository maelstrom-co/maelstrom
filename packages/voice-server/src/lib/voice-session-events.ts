import type { TelemetrySink } from '@maelstrom-co/telemetry';
import type {
  SpeechChunk,
  SttCircuitStatus,
  TranscriptionResult,
  VADEvent,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionCallbacks,
  VoiceSessionState,
} from './types.js';
import type {
  VoiceSessionEventBus,
  VoiceSessionEventSink,
} from './voice-session-events.contract.js';
import { createInitialVoiceSessionEventsState } from './voice-session-events.state.js';
import {
  recordVoiceSessionTelemetryMetric,
  recordVoiceSessionTelemetryTiming,
} from './telemetry.js';

type NotifyCallbackSafely = <T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  traceEvent: string,
  ...args: T
) => void;

type NotifyListenersSafely = <T>(
  listeners: Set<(value: T) => void>,
  value: T,
  traceEvent: string,
) => void;

export interface VoiceSessionInternalEventHub
  extends VoiceSessionEventBus,
    VoiceSessionEventSink {
  destroy(): void;
  isDestroyed(): boolean;
  notifyCallbackSafely: NotifyCallbackSafely;
  notifyListenersSafely: NotifyListenersSafely;
  reportAsyncFailure(
    traceEvent: string,
    error: unknown,
    details?: Record<string, unknown>,
  ): void;
  reportError(error: unknown): void;
  trace(event: string, details?: Record<string, unknown>): void;
}

export function createVoiceSessionEvents(
  callbacks: VoiceSessionCallbacks,
  traceCallback?: (event: string, details?: Record<string, unknown>) => void,
  telemetry?: TelemetrySink,
): VoiceSessionInternalEventHub {
  const state = createInitialVoiceSessionEventsState();
  let isReportingTraceCallbackFailure = false;

  function normalizeError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error(String(error), { cause: error });
  }

  function reportTraceCallbackFailure(event: string, error: unknown) {
    const traceError = new Error(
      `Voice session trace callback failed for "${event}"`,
      {
        cause: normalizeError(error),
      },
    );

    try {
      callbacks.onError?.(traceError);
    } catch (callbackError) {
      if (isReportingTraceCallbackFailure) {
        return;
      }

      isReportingTraceCallbackFailure = true;
      try {
        trace('callback.onError.failed', {
          message: traceError.message,
          callbackError: normalizeError(callbackError).message,
          sourceEvent: event,
        });
      } finally {
        isReportingTraceCallbackFailure = false;
      }
    }
  }

  function trace(event: string, details?: Record<string, unknown>) {
    if (!traceCallback) {
      return;
    }

    try {
      traceCallback(event, details);
    } catch (error) {
      reportTraceCallbackFailure(event, error);
    }
  }

  function reportError(error: unknown) {
    const normalizedError = normalizeError(error);

    try {
      callbacks.onError?.(normalizedError);
    } catch (callbackError) {
      trace('callback.onError.failed', {
        message: normalizedError.message,
        callbackError: normalizeError(callbackError).message,
      });
    }
  }

  function reportAsyncFailure(
    traceEvent: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) {
    trace(traceEvent, {
      ...details,
      message: normalizeError(error).message,
    });
    reportError(error);
  }

  function notifyListenersSafely<T>(
    listeners: Set<(value: T) => void>,
    value: T,
    traceEvent: string,
  ) {
    listeners.forEach((listener) => {
      try {
        listener(value);
      } catch (error) {
        trace(traceEvent, {
          message: normalizeError(error).message,
        });
        reportError(error);
      }
    });
  }

  function notifyCallbackSafely<T extends unknown[]>(
    callback: ((...args: T) => void) | undefined,
    traceEvent: string,
    ...args: T
  ) {
    if (!callback) {
      return;
    }

    try {
      callback(...args);
    } catch (error) {
      trace(traceEvent, {
        message: normalizeError(error).message,
      });
      reportError(error);
    }
  }

  function destroy() {
    state.destroyed = true;
    state.listeners.stateChange.clear();
    state.listeners.sttCircuitStatusChange.clear();
    state.listeners.transcript.clear();
    state.listeners.vad.clear();
    state.listeners.audioOutput.clear();
    state.listeners.audioDropped.clear();
  }

  function addListener<T>(
    listeners: Set<(value: T) => void>,
    callback: (value: T) => void,
  ) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  return {
    destroy,
    emitAudioDropped(event: VoiceSessionAudioDroppedEvent) {
      if (state.destroyed) {
        return;
      }

      notifyListenersSafely(
        state.listeners.audioDropped,
        event,
        'callback.onAudioDroppedListener.failed',
      );
      notifyCallbackSafely(
        callbacks.onAudioDropped,
        'callback.onAudioDropped.failed',
        event,
      );

      recordVoiceSessionTelemetryMetric(telemetry, {
        name: 'maelstrom.voice_server.audio.dropped_count',
        value: 1,
        attributes: {
          reason: event.reason,
        },
      });
      recordVoiceSessionTelemetryTiming(telemetry, {
        name: 'maelstrom.voice_server.audio.dropped_duration',
        duration: event.droppedDurationMs,
        attributes: {
          reason: event.reason,
        },
      });
    },
    emitAudioOutput(chunk: SpeechChunk) {
      notifyListenersSafely(
        state.listeners.audioOutput,
        chunk,
        'callback.onAudioOutputListener.failed',
      );
      notifyCallbackSafely(
        callbacks.onAudioOutput,
        'callback.onAudioOutput.failed',
        chunk,
      );

      return state.listeners.audioOutput.size;
    },
    emitSttCircuitStatusChange(status: SttCircuitStatus) {
      notifyListenersSafely(
        state.listeners.sttCircuitStatusChange,
        status,
        'callback.onSttCircuitStatusChangeListener.failed',
      );
    },
    emitTranscript(
      result: TranscriptionResult,
      options: { includeCallback: boolean },
    ) {
      notifyListenersSafely(
        state.listeners.transcript,
        result,
        'callback.onTranscriptListener.failed',
      );
      if (options.includeCallback) {
        notifyCallbackSafely(
          callbacks.onTranscript,
          'callback.onTranscript.failed',
          result,
        );
      }

      return state.listeners.transcript.size;
    },
    emitVADEvent(event: VADEvent) {
      notifyListenersSafely(
        state.listeners.vad,
        event,
        'callback.onVADEventListener.failed',
      );
      notifyCallbackSafely(
        callbacks.onVADEvent,
        'callback.onVADEvent.failed',
        event,
      );
    },
    emitVoiceStateChange(nextState: VoiceSessionState) {
      notifyListenersSafely(
        state.listeners.stateChange,
        nextState,
        'callback.onVoiceStateChangeListener.failed',
      );
      notifyCallbackSafely(
        callbacks.onVoiceStateChange,
        'callback.onVoiceStateChange.failed',
        nextState,
      );
    },
    isDestroyed: () => state.destroyed,
    notifyCallbackSafely,
    notifyListenersSafely,
    onAudioDropped(callback: (event: VoiceSessionAudioDroppedEvent) => void) {
      return addListener(state.listeners.audioDropped, callback);
    },
    onAudioOutput(callback: (chunk: SpeechChunk) => void) {
      return addListener(state.listeners.audioOutput, callback);
    },
    onSttCircuitStatusChange(
      callback: (status: SttCircuitStatus) => void,
      getCurrentStatus: () => SttCircuitStatus,
    ) {
      const unsubscribe = addListener(
        state.listeners.sttCircuitStatusChange,
        callback,
      );
      notifyCallbackSafely(
        callback,
        'callback.onSttCircuitStatusChange.failed',
        getCurrentStatus(),
      );
      return unsubscribe;
    },
    onTranscript(callback: (result: TranscriptionResult) => void) {
      return addListener(state.listeners.transcript, callback);
    },
    onVADEvent(callback: (event: VADEvent) => void) {
      return addListener(state.listeners.vad, callback);
    },
    onVoiceStateChange(
      callback: (state: import('./types.js').VoiceSessionState) => void,
    ) {
      return addListener(state.listeners.stateChange, callback);
    },
    reportAsyncFailure,
    reportError,
    trace,
  };
}
