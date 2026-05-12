import {
  bufferAudioChunk,
  flushBufferedAudio,
  measureAudioChunkDurationMs,
  type VoiceRuntimeAudioBufferContext,
} from './runtime.audio-buffer.js';
import {
  discardPendingAudioDropEvent,
  flushPendingAudioDropEvent,
  handleNonListeningAudioChunkDrop,
  schedulePendingAudioDropNotification,
} from './runtime.audio-drop.js';
import { resolveVoiceSessionConfig } from './runtime.config.js';
import {
  reconnectSTT as reconnectSTTHelper,
  type STTReconnectTrigger,
} from './runtime.reconnect.js';
import {
  createInitialVoiceRuntimeState,
  createVoiceRuntimeListeners,
} from './runtime.state.js';
import { handleSTTEvent as handleSTTEventHelper } from './runtime.stt-handler.js';
import {
  clearPendingFinalization,
  createForwardedTranscriptResult,
  emitFinalTranscript as emitFinalTranscriptHelper,
  finalizeTranscript as finalizeTranscriptHelper,
  forwardTranscriptResult,
  resetTurnTracking,
  updateTranscriptState,
} from './runtime.transcript.js';
import { handleTTSEvent as handleTTSEventHelper } from './runtime.tts-handler.js';
import { handleVADEvent as handleVADEventHelper } from './runtime.vad-handler.js';
import type {
  AudioChunk,
  SpeechChunk,
  STTEvent,
  SttCircuitStatus,
  TranscriptionResult,
  TTSEvent,
  VADEvent,
  VoiceSession,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionCallbacks,
  VoiceSessionConfig,
  VoiceSessionIntentRequestBuilder,
  VoiceSessionIntentRequestOptions,
  VoiceSessionState,
} from './types.js';

const defaultVadFinalDebounceMs = 500;
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
const autoRestartDelayMs = 500;

export { defaultAudioDropDebounceMs } from './runtime.audio-drop.js';

export interface SttDisconnectSuppressionController {
  isSuppressed(): boolean;
  suppress(): () => void;
}

export function createSttDisconnectSuppressionController(): SttDisconnectSuppressionController {
  let activeSuppressions = 0;

  return {
    isSuppressed() {
      return activeSuppressions > 0;
    },
    suppress() {
      activeSuppressions += 1;
      let released = false;

      return () => {
        if (released) {
          return;
        }

        released = true;
        activeSuppressions = Math.max(0, activeSuppressions - 1);
      };
    },
  };
}

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
    audioBufferMaxMs,
    maxReconnectAttempts,
    reconnectDelayMs,
    maxReconnectDelayMs,
    reconnectBackoffMultiplier,
    reconnectJitterMs,
    circuitBreakerTimeoutMs,
    trace: traceCallback,
    intentBoundary,
  } = resolveVoiceSessionConfig(config, {
    vadFinalDebounceMs: defaultVadFinalDebounceMs,
    audioBufferMaxMs: defaultAudioBufferMaxMs,
    maxReconnectAttempts: defaultMaxReconnectAttempts,
    reconnectDelayMs: defaultReconnectDelayMs,
    maxReconnectDelayMs: defaultMaxReconnectDelayMs,
    reconnectBackoffMultiplier: defaultReconnectBackoffMultiplier,
    reconnectJitterMs: defaultReconnectJitterMs,
    circuitBreakerTimeoutMs: defaultCircuitBreakerTimeoutMs,
  });

  const runtimeState = createInitialVoiceRuntimeState();
  const listeners = createVoiceRuntimeListeners();
  const sttDisconnectSuppression = createSttDisconnectSuppressionController();

  function reportTraceCallbackFailure(event: string, error: unknown) {
    const traceError = new Error(
      `Voice session trace callback failed for "${event}"`,
      {
        cause: normalizeError(error),
      },
    );

    try {
      callbacks.onError?.(traceError);
    } catch {}
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

  function normalizeError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error(String(error), { cause: error });
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
    activeListeners: Set<(value: T) => void>,
    value: T,
    traceEvent: string,
  ) {
    activeListeners.forEach((listener) => {
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

  function clearAutoRestartTimeout() {
    if (runtimeState.autoRestartTimeout) {
      clearTimeout(runtimeState.autoRestartTimeout);
      runtimeState.autoRestartTimeout = null;
    }
  }

  function clearBufferedAudio() {
    runtimeState.pendingAudioChunks.length = 0;
    runtimeState.pendingAudioDurationMs = 0;
  }

  function resetBufferedAudioState() {
    // WHY: Manual stop/destroy are explicit teardown boundaries. We intentionally discard any
    // pending debounced drop bucket here so stale loss telemetry does not leak into the next turn.
    clearBufferedAudio();
    discardPendingAudioDropEvent(runtimeState);
  }

  function emitAudioDropped(event: VoiceSessionAudioDroppedEvent) {
    notifyListenersSafely(
      listeners.audioDropped,
      event,
      'callback.onAudioDroppedListener.failed',
    );
    notifyCallbackSafely(
      callbacks.onAudioDropped,
      'callback.onAudioDropped.failed',
      event,
    );
  }

  function emitPendingAudioDropEvent(event: VoiceSessionAudioDroppedEvent) {
    if (runtimeState.destroyed) {
      return;
    }

    emitAudioDropped(event);
  }

  const audioBufferContext: VoiceRuntimeAudioBufferContext = {
    state: runtimeState,
    audioBufferMaxMs,
    trace,
    reportError,
    emitPendingAudioDropEvent,
    schedulePendingAudioDropNotification: () =>
      schedulePendingAudioDropNotification(
        runtimeState,
        emitPendingAudioDropEvent,
      ),
  };

  function abortActiveProcessing() {
    runtimeState.activeProcessAbortController?.abort();
    runtimeState.activeProcessAbortController = null;
  }

  function clearReconnectResetTimeout() {
    if (runtimeState.reconnectResetTimeout) {
      clearTimeout(runtimeState.reconnectResetTimeout);
      runtimeState.reconnectResetTimeout = null;
    }
  }

  function clearSttCircuitCooldownTimeout() {
    if (runtimeState.sttCircuitCooldownTimeout) {
      clearTimeout(runtimeState.sttCircuitCooldownTimeout);
      runtimeState.sttCircuitCooldownTimeout = null;
    }
  }

  function setSttCircuitStatus(status: SttCircuitStatus) {
    if (runtimeState.destroyed || runtimeState.sttCircuitStatus === status) {
      return;
    }

    trace('stt.circuit.status_changed', {
      previousStatus: runtimeState.sttCircuitStatus,
      nextStatus: status,
      reconnectDelayMs,
      maxReconnectDelayMs,
      reconnectBackoffMultiplier,
      reconnectJitterMs,
      circuitBreakerTimeoutMs,
    });

    runtimeState.sttCircuitStatus = status;
    notifyListenersSafely(
      listeners.sttCircuitStatusChange,
      status,
      'callback.onSttCircuitStatusChangeListener.failed',
    );
  }

  function closeSttCircuit() {
    runtimeState.sttCircuitOpenedAt = null;
    clearSttCircuitCooldownTimeout();
    setSttCircuitStatus('closed');
  }

  function openSttCircuit() {
    runtimeState.sttCircuitOpenedAt = Date.now();
    clearSttCircuitCooldownTimeout();
    setSttCircuitStatus('open');

    runtimeState.sttCircuitCooldownTimeout = setTimeout(() => {
      runtimeState.sttCircuitCooldownTimeout = null;

      if (runtimeState.destroyed || runtimeState.sttCircuitStatus !== 'open') {
        return;
      }

      setSttCircuitStatus('half_open');
    }, circuitBreakerTimeoutMs);
  }

  // WHY: Provider callbacks can settle out of order. The generation token lets the runtime ignore
  // stale stop/completion signals from an older utterance, and the finished flag makes the winning
  // utterance complete exactly once.
  let activeSpeechGeneration = 0;
  let activeSpeech = {
    generation: 0,
    finished: true,
  };

  function completeActiveSpeech(
    generation: number,
    completed: boolean,
    nextState: VoiceSessionState = 'idle',
  ) {
    if (
      runtimeState.destroyed ||
      activeSpeech.generation !== generation ||
      activeSpeech.finished
    ) {
      return;
    }

    activeSpeech.finished = true;
    setVoiceState(nextState);
    notifyCallbackSafely(
      callbacks.onSpeechStopped,
      'callback.onSpeechStopped.failed',
      completed,
    );
  }

  function interruptActiveSpeech() {
    completeActiveSpeech(activeSpeech.generation, false);
  }

  function setVoiceState(newState: VoiceSessionState) {
    if (runtimeState.destroyed) return;
    if (runtimeState.state === newState) return;

    const previousState = runtimeState.state;
    trace('voice.state_change', {
      previousState,
      nextState: newState,
    });
    runtimeState.state = newState;
    notifyListenersSafely(
      listeners.stateChange,
      newState,
      'callback.onVoiceStateChangeListener.failed',
    );
    notifyCallbackSafely(
      callbacks.onVoiceStateChange,
      'callback.onVoiceStateChange.failed',
      newState,
    );

    if (
      newState === 'idle' &&
      autoRestartListening &&
      previousState === 'speaking'
    ) {
      if (runtimeState.suppressNextAutoRestart) {
        runtimeState.suppressNextAutoRestart = false;
        return;
      }

      runtimeState.autoRestartTimeout = setTimeout(() => {
        if (!runtimeState.destroyed && runtimeState.state === 'idle') {
          void startListening().catch((error) => {
            reportAsyncFailure('stt.auto_restart.failed', error);
          });
        }
      }, autoRestartDelayMs);
    }
  }

  async function executeIntentRequest(
    createRequest: () => Promise<
      Awaited<ReturnType<VoiceSessionIntentRequestBuilder>>
    >,
    options: {
      speakResponse?: boolean;
      traceDetails?: Record<string, unknown>;
    } = {},
  ): Promise<
    | Awaited<
        ReturnType<
          NonNullable<typeof intentBoundary>['processIntent']['process']
        >
      >
    | undefined
  > {
    if (!intentBoundary || runtimeState.destroyed) {
      return undefined;
    }

    clearAutoRestartTimeout();

    if (runtimeState.state === 'speaking') {
      tts.stop();
    }

    setVoiceState('processing');
    const abortController = new AbortController();
    const previousAbortController = runtimeState.activeProcessAbortController;
    runtimeState.activeProcessAbortController = abortController;
    previousAbortController?.abort();

    trace('intent.processing.started', {
      ...options.traceDetails,
    });

    try {
      const request = await createRequest();

      // WHY: Request building and intent execution can overlap with a newer turn. The identity check
      // ensures only the latest generation is allowed to emit results or mutate runtime state.
      if (
        runtimeState.destroyed ||
        abortController.signal.aborted ||
        runtimeState.activeProcessAbortController !== abortController
      ) {
        return undefined;
      }

      const response = await Promise.resolve().then(() =>
        intentBoundary.processIntent.process(request, abortController.signal),
      );

      if (
        runtimeState.destroyed ||
        runtimeState.activeProcessAbortController !== abortController
      ) {
        return undefined;
      }

      trace('intent.processing.completed', {
        requestId: response.requestId,
        replyLength: response.userMessage.length,
      });

      if (response.userMessage && options.speakResponse !== false) {
        await speak(response.userMessage);
      } else if (runtimeState.state === 'processing') {
        setVoiceState('idle');
      }

      return response;
    } catch (error: unknown) {
      if (abortController.signal.aborted) {
        trace('intent.processing.aborted');
        return undefined;
      }

      reportError(error);
      if (
        runtimeState.activeProcessAbortController === abortController &&
        runtimeState.state === 'processing'
      ) {
        setVoiceState('idle');
      }
      return undefined;
    } finally {
      if (runtimeState.activeProcessAbortController === abortController) {
        runtimeState.activeProcessAbortController = null;
      }
    }
  }

  function processTranscript(text: string): boolean {
    if (!intentBoundary) {
      return false;
    }

    const buildIntentRequest: VoiceSessionIntentRequestBuilder =
      intentBoundary.buildChartRequest;

    void executeIntentRequest(
      () =>
        Promise.resolve(buildIntentRequest({ transcript: text, sessionId })),
      {
        traceDetails: {
          textLength: text.length,
          preview: text.slice(0, 80),
        },
      },
    );

    return true;
  }

  function finalizeTranscript(text: string) {
    return finalizeTranscriptHelper(
      runtimeState,
      listeners,
      callbacks,
      notifyListenersSafely,
      notifyCallbackSafely,
      processTranscript,
      text,
    );
  }

  function emitFinalTranscript() {
    emitFinalTranscriptHelper(
      runtimeState,
      clearPendingFinalization,
      finalizeTranscript,
      reportError,
      setVoiceState,
    );
  }

  function forwardFinalOrInterimTranscript(result: TranscriptionResult) {
    forwardTranscriptResult(
      listeners,
      callbacks,
      notifyListenersSafely,
      notifyCallbackSafely,
      trace,
      interimResults,
      result,
    );
  }

  function handleSTTEvent(event: STTEvent) {
    if (
      event.type === 'disconnected' &&
      sttDisconnectSuppression.isSuppressed()
    ) {
      return;
    }

    handleSTTEventHelper(
      runtimeState,
      stt.name,
      trace,
      (result) => updateTranscriptState(runtimeState, result),
      emitFinalTranscript,
      (result) => createForwardedTranscriptResult(runtimeState, result),
      forwardFinalOrInterimTranscript,
      reportError,
      reconnectSTT,
      setVoiceState,
      event,
    );
  }

  async function ensureSTTConnected() {
    if (runtimeState.destroyed) return;
    if (stt.isConnected()) return;

    const connectConfig: { language?: string } = {};
    if (language) {
      connectConfig.language = language;
    }

    trace('stt.connecting', {
      provider: stt.name,
      language: connectConfig.language ?? null,
      circuitStatus: runtimeState.sttCircuitStatus,
    });
    await stt.connect(connectConfig);
    if (!runtimeState.sttUnsubscribe) {
      runtimeState.sttUnsubscribe = stt.onEvent(handleSTTEvent);
    }
  }

  async function connectForegroundSTT(
    operation: 'start_listening' | 'warmup',
  ): Promise<void> {
    if (runtimeState.sttCircuitStatus === 'open') {
      trace('stt.connect.skipped', {
        operation,
        reason: 'circuit_open',
      });

      throw new Error(
        operation === 'warmup'
          ? 'Cannot warm up while the STT circuit is open'
          : 'Cannot start listening while the STT circuit is open',
      );
    }

    try {
      await ensureSTTConnected();
    } catch (error) {
      if (runtimeState.sttCircuitStatus === 'half_open') {
        openSttCircuit();
      }

      throw error;
    }

    if (runtimeState.sttCircuitStatus === 'half_open') {
      closeSttCircuit();
    }
  }

  async function connectSTT(forceReconnect = false) {
    if (forceReconnect && stt.isConnected()) {
      const releaseDisconnectSuppression = sttDisconnectSuppression.suppress();

      try {
        // WHY: Forced reconnect tears down the old STT transport on purpose. Suppressing that
        // expected disconnect keeps it from being misread as a fresh outage that should schedule a
        // second reconnect loop.
        await stt.disconnect();
      } finally {
        releaseDisconnectSuppression();
      }
    }

    await ensureSTTConnected();
  }

  async function reconnectSTT(trigger: STTReconnectTrigger): Promise<void> {
    return reconnectSTTHelper({
      state: runtimeState,
      trigger,
      maxReconnectAttempts,
      reconnectDelayMs,
      maxReconnectDelayMs,
      reconnectBackoffMultiplier,
      reconnectJitterMs,
      trace,
      reportError,
      connectSTT,
      flushBufferedAudio: (traceEvent) =>
        flushBufferedAudio(audioBufferContext, stt, traceEvent),
      flushPendingAudioDropEvent: () =>
        flushPendingAudioDropEvent(runtimeState, emitPendingAudioDropEvent),
      resetBufferedAudioState,
      setVoiceState,
      openSttCircuit,
      closeSttCircuit,
    });
  }

  function handleTTSEvent(event: TTSEvent) {
    handleTTSEventHelper(
      runtimeState,
      listeners,
      callbacks,
      tts.name,
      trace,
      notifyListenersSafely,
      notifyCallbackSafely,
      reportError,
      interruptActiveSpeech,
      event,
    );
  }

  async function ensureTTSConnected() {
    if (tts.isConnected()) return;

    trace('tts.connecting', {
      provider: tts.name,
    });
    await tts.connect();
    if (!runtimeState.ttsUnsubscribe) {
      runtimeState.ttsUnsubscribe = tts.onEvent(handleTTSEvent);
    }
  }

  function cleanupProviders() {
    runtimeState.sttUnsubscribe?.();
    runtimeState.sttUnsubscribe = null;
    runtimeState.ttsUnsubscribe?.();
    runtimeState.ttsUnsubscribe = null;
    void stt.disconnect().catch((error) => {
      reportAsyncFailure('stt.disconnect.failed', error);
    });
    void tts.disconnect().catch((error) => {
      reportAsyncFailure('tts.disconnect.failed', error);
    });
  }

  async function startListening(): Promise<void> {
    if (runtimeState.destroyed) {
      throw new Error('Cannot start listening after destroy()');
    }
    if (runtimeState.state === 'listening') return;
    if (runtimeState.startListeningPromise)
      return runtimeState.startListeningPromise;

    if (
      runtimeState.state !== 'idle' &&
      runtimeState.state !== 'speaking' &&
      runtimeState.state !== 'processing'
    ) {
      throw new Error(`Cannot start listening in state: ${runtimeState.state}`);
    }

    runtimeState.startListeningPromise = (async () => {
      trace('stt.start_listening.requested', {
        state: runtimeState.state,
        pendingBufferedAudioMs: runtimeState.pendingAudioDurationMs,
        isInitializing: runtimeState.isInitializing,
      });

      clearAutoRestartTimeout();

      if (runtimeState.state === 'processing') {
        abortActiveProcessing();
      }

      runtimeState.isInitializing = true;
      await connectForegroundSTT('start_listening');

      if (runtimeState.destroyed) {
        return;
      }
      resetTurnTracking(runtimeState);
      setVoiceState('listening');

      flushBufferedAudio(audioBufferContext, stt, 'stt.buffered_audio.sent');
    })();

    try {
      await runtimeState.startListeningPromise;
    } finally {
      runtimeState.isInitializing = false;
      runtimeState.startListeningPromise = null;
    }
  }

  async function stopListening(): Promise<void> {
    if (runtimeState.destroyed) return;
    if (runtimeState.state !== 'listening') return;

    trace('stt.stop_listening.requested', {
      accumulatedTranscriptLength: runtimeState.accumulatedTranscript.length,
      currentTranscriptLength: runtimeState.currentTranscript.length,
      hasEmittedFinal: runtimeState.hasEmittedFinal,
      hasReceivedSpeech: runtimeState.hasReceivedSpeech,
      pendingBufferedAudioMs: runtimeState.pendingAudioDurationMs,
    });

    // Reuse the existing pending-finalization path so providers that synchronously flush a final
    // transcript from endStream() finalize that turn exactly once before the manual fallback runs.
    runtimeState.pendingFinalFromVAD = true;
    stt.endStream();
    const transcriptToFinalize =
      runtimeState.currentTranscript || runtimeState.accumulatedTranscript;
    flushPendingAudioDropEvent(runtimeState, emitPendingAudioDropEvent);
    clearBufferedAudio();
    clearPendingFinalization(runtimeState);

    const { emitted, startedProcessing } =
      finalizeTranscript(transcriptToFinalize);

    if (emitted) {
      trace('stt.manual_final_transcript.forwarded', {
        textLength: transcriptToFinalize.length,
        preview: transcriptToFinalize.slice(0, 80),
      });
    }

    if (!runtimeState.hasReceivedSpeech) {
      setVoiceState('idle');
      return;
    }

    if (!startedProcessing && runtimeState.state === 'listening') {
      setVoiceState('idle');
    }
  }

  function interrupt(): void {
    if (runtimeState.destroyed) return;
    clearAutoRestartTimeout();
    abortActiveProcessing();

    if (runtimeState.state === 'speaking') {
      runtimeState.suppressNextAutoRestart = true;
      tts.stop();
      interruptActiveSpeech();
      notifyCallbackSafely(
        callbacks.onInterrupt,
        'callback.onInterrupt.failed',
        'user',
      );
      return;
    }

    if (runtimeState.state === 'processing') {
      setVoiceState('idle');
      notifyCallbackSafely(
        callbacks.onInterrupt,
        'callback.onInterrupt.failed',
        'user',
      );
      return;
    }

    if (runtimeState.state === 'listening') {
      stt.endStream();
      setVoiceState('idle');
      notifyCallbackSafely(
        callbacks.onInterrupt,
        'callback.onInterrupt.failed',
        'user',
      );
    }
  }

  async function speak(text: string, voice?: string): Promise<void> {
    if (runtimeState.destroyed) {
      throw new Error('Cannot speak after destroy()');
    }
    trace('tts.speak.requested', {
      textLength: text.length,
      preview: text.slice(0, 80),
      requestedVoice: voice ?? null,
      provider: tts.name,
      providerConnected: tts.isConnected(),
      state: runtimeState.state,
    });

    if (runtimeState.state === 'speaking') {
      tts.stop();
    }

    if (!tts.isConnected()) {
      await ensureTTSConnected();
    }

    if (runtimeState.destroyed) {
      return;
    }

    const speakOptions: { voice?: string } = {};
    if (voice) {
      speakOptions.voice = voice;
    }
    const generation = activeSpeechGeneration + 1;
    const handle = tts.speak(text, speakOptions);

    activeSpeechGeneration = generation;
    activeSpeech = {
      generation,
      finished: false,
    };
    setVoiceState('speaking');
    trace('tts.speak.dispatched', {
      provider: tts.name,
      requestedVoice: speakOptions.voice ?? null,
      generation,
    });
    notifyCallbackSafely(
      callbacks.onSpeechStarted,
      'callback.onSpeechStarted.failed',
      handle.speech,
    );

    // WHY: `SpeechSynthesisHandle.completion` is a non-rejecting public contract. This runtime
    // catch is only an invariant guard for provider-contract violations so an unexpected rejection
    // is surfaced through normal error reporting instead of leaving the active speech generation
    // hanging forever.
    void handle.completion
      .then((reason) => {
        if (reason === 'completed') {
          completeActiveSpeech(generation, true);
          return;
        }

        completeActiveSpeech(generation, false);
      })
      .catch((error) => {
        reportAsyncFailure('tts.completion.failed', error, {
          provider: tts.name,
          generation,
        });
        completeActiveSpeech(generation, false);
      });
  }

  function handleVADEvent(event: VADEvent): void {
    handleVADEventHelper(
      runtimeState,
      listeners,
      callbacks,
      vadFinalDebounceMs,
      trace,
      notifyListenersSafely,
      notifyCallbackSafely,
      () => clearPendingFinalization(runtimeState),
      emitFinalTranscript,
      event,
    );
  }

  function destroy(): void {
    runtimeState.destroyed = true;
    clearAutoRestartTimeout();
    clearReconnectResetTimeout();
    clearSttCircuitCooldownTimeout();
    clearPendingFinalization(runtimeState);
    abortActiveProcessing();
    resetBufferedAudioState();
    cleanupProviders();
    listeners.stateChange.clear();
    listeners.sttCircuitStatusChange.clear();
    listeners.transcript.clear();
    listeners.vad.clear();
    listeners.audioOutput.clear();
    listeners.audioDropped.clear();
  }

  return {
    getVoiceState: () => runtimeState.state,
    getSttCircuitStatus: () => runtimeState.sttCircuitStatus,
    warmup(): Promise<void> {
      return Promise.all([
        connectForegroundSTT('warmup'),
        ensureTTSConnected(),
      ]).then(() => undefined);
    },
    startListening,
    stopListening,
    interrupt,
    processRequest(
      request,
      options: VoiceSessionIntentRequestOptions = {},
    ): Promise<
      | Awaited<
          ReturnType<
            NonNullable<typeof intentBoundary>['processIntent']['process']
          >
        >
      | undefined
    > {
      return executeIntentRequest(() => Promise.resolve(request), {
        speakResponse: options.speakResponse,
        traceDetails: {
          explicitRequest: true,
        },
      });
    },
    onVoiceStateChange(
      callback: (nextState: VoiceSessionState) => void,
    ): () => void {
      listeners.stateChange.add(callback);
      return () => listeners.stateChange.delete(callback);
    },
    onSttCircuitStatusChange(
      callback: (status: SttCircuitStatus) => void,
    ): () => void {
      listeners.sttCircuitStatusChange.add(callback);
      notifyCallbackSafely(
        callback,
        'callback.onSttCircuitStatusChange.failed',
        runtimeState.sttCircuitStatus,
      );
      return () => listeners.sttCircuitStatusChange.delete(callback);
    },
    onTranscript(callback: (result: TranscriptionResult) => void): () => void {
      listeners.transcript.add(callback);
      return () => listeners.transcript.delete(callback);
    },
    onVADEvent(callback: (event: VADEvent) => void): () => void {
      listeners.vad.add(callback);
      return () => listeners.vad.delete(callback);
    },
    onAudioOutput(callback: (chunk: SpeechChunk) => void): () => void {
      listeners.audioOutput.add(callback);
      return () => listeners.audioOutput.delete(callback);
    },
    onAudioDropped(callback): () => void {
      listeners.audioDropped.add(callback);
      return () => listeners.audioDropped.delete(callback);
    },
    shouldAutoRestart(): boolean {
      return autoRestartListening && runtimeState.state === 'idle';
    },
    sendAudioChunk(chunk: AudioChunk): void {
      if (runtimeState.destroyed) {
        return;
      }
      if (runtimeState.isInitializing || runtimeState.state === 'idle') {
        bufferAudioChunk(
          audioBufferContext,
          chunk,
          'pre_connection_buffer_full',
          'stt.audio.buffered',
          {
            bytes: chunk.data.length,
            sampleRate: chunk.sampleRate,
            encoding: chunk.encoding,
            state: runtimeState.state,
            isInitializing: runtimeState.isInitializing,
          },
        );
        return;
      }

      if (runtimeState.state !== 'listening') {
        handleNonListeningAudioChunkDrop({
          state: runtimeState,
          voiceState: runtimeState.state,
          chunk,
          measureAudioChunkDurationMs,
          normalizeError,
          trace,
          emitPendingAudioDropEvent,
          reportError,
        });
        return;
      }

      if (stt.isConnected()) {
        try {
          trace('stt.audio.sent', {
            bytes: chunk.data.length,
            sampleRate: chunk.sampleRate,
            encoding: chunk.encoding,
          });
          stt.sendAudio(chunk);
        } catch (error) {
          const normalizedError = normalizeError(error);
          trace('stt.audio.send_failed', {
            bytes: chunk.data.length,
            sampleRate: chunk.sampleRate,
            encoding: chunk.encoding,
            message: normalizedError.message,
          });
          reportError(
            new Error('Failed to send STT audio chunk while listening', {
              cause: normalizedError,
            }),
          );

          bufferAudioChunk(
            audioBufferContext,
            chunk,
            'stt_send_failed',
            'stt.audio.buffered.after_send_failure',
            {
              bytes: chunk.data.length,
              sampleRate: chunk.sampleRate,
              encoding: chunk.encoding,
              state: runtimeState.state,
            },
          );
        }
        return;
      }

      bufferAudioChunk(
        audioBufferContext,
        chunk,
        'reconnect_buffer_full',
        'stt.audio.buffered.waiting_for_connection',
        {
          bytes: chunk.data.length,
          sampleRate: chunk.sampleRate,
          encoding: chunk.encoding,
        },
      );
    },
    speak,
    handleVADEvent,
    destroy,
  };
}
