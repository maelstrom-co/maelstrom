import { createAudioBufferQueue } from './audio-buffer-queue.js';
import { resolveVoiceSessionConfig } from './runtime.config.js';
import { createSTTSessionManager } from './stt-session-manager.js';
import {
  emitVoiceSessionTelemetryEvent,
  recordVoiceSessionTelemetryMetric,
  recordVoiceSessionTelemetryTiming,
} from './telemetry.js';
import { createTTSSessionManager } from './tts-session-manager.js';
import { createTurnCoordinator } from './turn-coordinator.js';
import type {
  AudioChunk,
  SttCircuitStatus,
  VADEvent,
  VoiceSession,
  VoiceSessionCallbacks,
  VoiceSessionConfig,
} from './types.js';
import { createVADCoordinator } from './vad-coordinator.js';
import { createVoiceSessionEvents } from './voice-session-events.js';

const defaultVadFinalDebounceMs = 500;
const defaultTranscriptGraceMs = 1500;
const defaultAudioBufferMaxMs = 1000;
// WHY: Five attempts gives the runtime enough room to ride out short network churn while still
// surfacing a real outage quickly. A much lower default opens the circuit too aggressively, and a
// much higher one delays failure visibility behind a long reconnect loop.
const defaultMaxReconnectAttempts = 5;
const defaultReconnectDelayMs = 1000;
const defaultMaxReconnectDelayMs = 30000;
const defaultReconnectBackoffMultiplier = 2;
const defaultReconnectJitterMs = 0;
const defaultCircuitBreakerTimeoutMs = 60000;

export { defaultAudioDropDebounceMs } from './audio-buffer-queue.js';

/**
 * Creates the runtime that turns injected STT, TTS, and client VAD signals into a single
 * conversational voice session.
 *
 * @remarks
 * The important design choice here is the boundary between voice transport and intent handling.
 * This runtime owns the mechanics that should behave the same in every app: provider lifecycle,
 * transcript accumulation, reconnection, buffering, and turn-taking. It intentionally does not
 * own application language or intent processing. Instead, final transcripts cross that boundary
 * through {@link VoiceSessionConfig.buildChartRequest} and
 * {@link VoiceSessionConfig.processIntent}, which let each app decide how to process the
 * utterance and what reply, if any, should be spoken back.
 *
 * Keeping that boundary in the runtime prevents the engine package from becoming coupled to
 * provider-specific voice concerns and keeps application vocabulary, such as domain keyterms,
 * outside the shared package.
 */
export function createVoiceSession(
  config: VoiceSessionConfig,
  callbacks: VoiceSessionCallbacks = {},
): VoiceSession {
  const {
    stt,
    tts,
    sessionId,
    language,
    interimResults,
    autoRestartListening,
    vadFinalDebounceMs,
    transcriptGraceMs,
    audioBufferMaxMs,
    maxReconnectAttempts,
    reconnectDelayMs,
    maxReconnectDelayMs,
    reconnectBackoffMultiplier,
    reconnectJitterMs,
    circuitBreakerTimeoutMs,
    trace: traceCallback,
    telemetry,
    intentBoundary,
  } = resolveVoiceSessionConfig(config, {
    vadFinalDebounceMs: defaultVadFinalDebounceMs,
    transcriptGraceMs: defaultTranscriptGraceMs,
    audioBufferMaxMs: defaultAudioBufferMaxMs,
    maxReconnectAttempts: defaultMaxReconnectAttempts,
    reconnectDelayMs: defaultReconnectDelayMs,
    maxReconnectDelayMs: defaultMaxReconnectDelayMs,
    reconnectBackoffMultiplier: defaultReconnectBackoffMultiplier,
    reconnectJitterMs: defaultReconnectJitterMs,
    circuitBreakerTimeoutMs: defaultCircuitBreakerTimeoutMs,
  });
  const sessionStartedAt = performance.now();

  const sessionEvents = createVoiceSessionEvents(
    callbacks,
    traceCallback,
    telemetry,
  );
  let hasEmittedSessionCompletionTelemetry = false;

  function resetBufferedAudioState() {
    // WHY: Manual stop/destroy are explicit teardown boundaries. We intentionally discard any
    // pending debounced drop bucket here so stale loss telemetry does not leak into the next turn.
    audioBufferQueue.reset();
  }

  const audioBufferQueue = createAudioBufferQueue({
    audioBufferMaxMs,
    trace: sessionEvents.trace,
    reportError: sessionEvents.reportError,
    emitAudioDropped: sessionEvents.emitAudioDropped,
    isDestroyed: sessionEvents.isDestroyed,
  });

  // WHY: These `let` declarations allow turnCoordinator to be created before the managers via
  // closure-based lazy refs, breaking the circular dependency without introducing a separate
  // indirection layer. Each getter is only invoked at call time, by which point all managers
  // have been assigned below.
  let ttsSessionManager: ReturnType<typeof createTTSSessionManager>;
  let sttSessionManager: ReturnType<typeof createSTTSessionManager>;
  let vadCoordinator: ReturnType<typeof createVADCoordinator>;

  const turnCoordinator = createTurnCoordinator({
    sessionId,
    intentBoundary: intentBoundary ?? undefined,
    autoRestartListening,
    transcriptGraceMs,
    interimResults,
    isDestroyed: sessionEvents.isDestroyed,
    trace: sessionEvents.trace,
    reportError: sessionEvents.reportError,
    reportAsyncFailure: sessionEvents.reportAsyncFailure,
    notifyCallbackSafely: sessionEvents.notifyCallbackSafely,
    telemetry,
    eventSink: sessionEvents,
    emitStateTelemetry(previousState, newState) {
      emitVoiceSessionTelemetryEvent(telemetry, {
        name: 'maelstrom.voice_server.state_changed',
        attributes: {
          previousState,
          nextState: newState,
        },
      });
    },
    callbacks,
    getSttStartListening: () => sttSessionManager.startListening,
    getTTSStop:
      () =>
      (nextState = 'idle') =>
        ttsSessionManager.stop(nextState),
    getTTSSpeak: () => (text, opts) => speak(text, opts.voice),
    getSttEndStream: () => sttSessionManager.endStream,
    getVADClearPendingFinalization: () => () =>
      vadCoordinator.clearPendingFinalization(),
    getVADIsPendingFinalFromVAD: () => () =>
      vadCoordinator.isPendingFinalFromVAD(),
  });

  ttsSessionManager = createTTSSessionManager(tts, {
    isDestroyed: sessionEvents.isDestroyed,
    getVoiceState: turnCoordinator.getVoiceState,
    setVoiceState: turnCoordinator.setVoiceState,
    trace: sessionEvents.trace,
    reportError: sessionEvents.reportError,
    reportAsyncFailure: sessionEvents.reportAsyncFailure,
    notifyCallbackSafely: sessionEvents.notifyCallbackSafely,
    emitAudioOutput: sessionEvents.emitAudioOutput,
    onSpeechStarted: callbacks.onSpeechStarted,
    onSpeechStopped: callbacks.onSpeechStopped,
    telemetry: {
      emitProviderError(event, metric) {
        recordVoiceSessionTelemetryMetric(telemetry, metric);
        emitVoiceSessionTelemetryEvent(telemetry, event);
      },
      recordConnectDuration(timing) {
        recordVoiceSessionTelemetryTiming(telemetry, timing);
      },
      recordQueuedTurnsCount(metric) {
        recordVoiceSessionTelemetryMetric(telemetry, metric);
      },
      recordQueuedTurnsDroppedCount(metric) {
        recordVoiceSessionTelemetryMetric(telemetry, metric);
      },
      recordFirstByteDuration(timing) {
        recordVoiceSessionTelemetryTiming(telemetry, timing);
      },
      recordSynthesizeDuration(timing) {
        recordVoiceSessionTelemetryTiming(telemetry, timing);
      },
    },
  });

  vadCoordinator = createVADCoordinator({
    vadFinalDebounceMs,
    trace: sessionEvents.trace,
    emitVADEvent: sessionEvents.emitVADEvent,
    clearPendingFinalization: turnCoordinator.clearPendingFinalization,
    emitFinalTranscript: turnCoordinator.emitFinalTranscript,
  });

  sttSessionManager = createSTTSessionManager(stt, audioBufferQueue, {
    language,
    maxReconnectAttempts,
    reconnectDelayMs,
    maxReconnectDelayMs,
    reconnectBackoffMultiplier,
    reconnectJitterMs,
    circuitBreakerTimeoutMs,
    isDestroyed: sessionEvents.isDestroyed,
    getVoiceState: turnCoordinator.getVoiceState,
    setVoiceState: turnCoordinator.setVoiceState,
    trace: sessionEvents.trace,
    reportError: sessionEvents.reportError,
    clearAutoRestartTimeout: turnCoordinator.clearAutoRestartTimeout,
    abortActiveProcessing: turnCoordinator.abortActiveProcessing,
    resetTurnTracking: turnCoordinator.resetTurnTracking,
    getTurnState: turnCoordinator.getTurnState,
    setPendingFinalFromVAD(value) {
      vadCoordinator.setPendingFinalFromVAD(value);
    },
    setSuppressIncomingAudio: turnCoordinator.setSuppressIncomingAudio,
    markHasSentAudioForTurn: turnCoordinator.markHasSentAudioForTurn,
    clearPendingFinalization: turnCoordinator.clearPendingFinalization,
    startTranscriptGrace: turnCoordinator.startTranscriptGrace,
    finalizeTranscript: turnCoordinator.finalizeTranscript,
    updateTranscriptState: turnCoordinator.updateTranscriptState,
    emitFinalTranscript: turnCoordinator.emitFinalTranscript,
    createForwardedTranscriptResult:
      turnCoordinator.createForwardedTranscriptResult,
    forwardTranscriptResult: turnCoordinator.forwardTranscriptResult,
    eventBus: {
      emitSttCircuitStatusChange: sessionEvents.emitSttCircuitStatusChange,
    },
    telemetry: {
      recordConnectDuration(timing) {
        recordVoiceSessionTelemetryTiming(telemetry, timing);
      },
      recordFirstTokenDuration(timing) {
        recordVoiceSessionTelemetryTiming(telemetry, timing);
      },
      emitTranscriptMetadata(event) {
        emitVoiceSessionTelemetryEvent(telemetry, event);
      },
      emitProviderError(event, metric) {
        recordVoiceSessionTelemetryMetric(telemetry, metric);
        emitVoiceSessionTelemetryEvent(telemetry, event);
      },
    },
  });

  if (telemetry) {
    emitVoiceSessionTelemetryEvent(telemetry, {
      name: 'maelstrom.voice_server.session.started',
    });
  }

  function cleanupProviders() {
    void sttSessionManager.disconnect().catch((error) => {
      sessionEvents.reportAsyncFailure('stt.disconnect.failed', error);
    });
    void ttsSessionManager.disconnect().catch((error) => {
      sessionEvents.reportAsyncFailure('tts.disconnect.failed', error);
    });
  }

  async function speak(text: string, voice?: string): Promise<void> {
    if (sessionEvents.isDestroyed()) {
      throw new Error('Cannot speak after destroy()');
    }

    await ttsSessionManager.speakNow(text, voice);
  }

  function handleVADEvent(event: VADEvent): void {
    vadCoordinator.handleVADEvent(event);
  }

  function destroy(): void {
    if (telemetry && !hasEmittedSessionCompletionTelemetry) {
      hasEmittedSessionCompletionTelemetry = true;
      emitVoiceSessionTelemetryEvent(telemetry, {
        name: 'maelstrom.voice_server.session.completed',
      });
      recordVoiceSessionTelemetryTiming(telemetry, {
        name: 'maelstrom.voice_server.session.duration',
        duration: performance.now() - sessionStartedAt,
      });
    }

    sessionEvents.destroy();
    ttsSessionManager.destroy();
    turnCoordinator.destroy();
    vadCoordinator.destroy();
    resetBufferedAudioState();
    cleanupProviders();
  }

  return {
    getVoiceState: turnCoordinator.getVoiceState,
    getSttCircuitStatus: () => sttSessionManager.getCircuitStatus(),
    warmup(): Promise<void> {
      return Promise.all([
        sttSessionManager.connect('warmup'),
        ttsSessionManager.connect(),
      ]).then(() => undefined);
    },
    startListening: () => sttSessionManager.startListening(),
    stopListening: () => sttSessionManager.stopListening(),
    interrupt: turnCoordinator.interrupt,
    enqueueSpeak(text: string, voice?: string): void {
      ttsSessionManager.enqueueSpeak(text, voice);
    },
    processRequest(request, options = {}) {
      return turnCoordinator.processRequest(request, options);
    },
    onVoiceStateChange: sessionEvents.onVoiceStateChange,
    onSttCircuitStatusChange(callback: (status: SttCircuitStatus) => void) {
      return sessionEvents.onSttCircuitStatusChange(
        callback,
        sttSessionManager.getCircuitStatus,
      );
    },
    onTranscript: sessionEvents.onTranscript,
    onVADEvent: sessionEvents.onVADEvent,
    onAudioOutput: sessionEvents.onAudioOutput,
    onAudioDropped: sessionEvents.onAudioDropped,
    shouldAutoRestart(): boolean {
      return autoRestartListening && turnCoordinator.getVoiceState() === 'idle';
    },
    sendAudioChunk(chunk: AudioChunk): void {
      sttSessionManager.sendAudio(chunk);
    },
    speak,
    handleVADEvent,
    destroy,
  };
}
