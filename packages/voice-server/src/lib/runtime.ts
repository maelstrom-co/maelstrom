import {
  bufferAudioChunk,
  flushBufferedAudio,
} from './runtime.audio-buffer.js';
import { reconnectSTT as reconnectSTTHelper } from './runtime.reconnect.js';
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
  TranscriptionResult,
  TTSEvent,
  VADEvent,
  VoiceSession,
  VoiceSessionCallbacks,
  VoiceSessionConfig,
  VoiceSessionIntentRequestBuilder,
  VoiceSessionIntentRequestOptions,
  VoiceSessionState,
} from './types.js';
import { resolveVoiceSessionConfig } from './types.js';

const defaultVadFinalDebounceMs = 500;
const defaultMaxPendingAudioChunks = 50;
const defaultMaxReconnectAttempts = 3;
const defaultReconnectDelayMs = 1000;
const autoRestartDelayMs = 500;

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
    maxPendingAudioChunks,
    maxReconnectAttempts,
    reconnectDelayMs,
    trace: traceCallback,
    intentBoundary,
  } = resolveVoiceSessionConfig(config, {
    vadFinalDebounceMs: defaultVadFinalDebounceMs,
    maxPendingAudioChunks: defaultMaxPendingAudioChunks,
    maxReconnectAttempts: defaultMaxReconnectAttempts,
    reconnectDelayMs: defaultReconnectDelayMs,
  });

  const runtimeState = createInitialVoiceRuntimeState();
  const listeners = createVoiceRuntimeListeners();

  function trace(event: string, details?: Record<string, unknown>) {
    if (!traceCallback) {
      return;
    }

    traceCallback(event, details);
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
    });
    await stt.connect(connectConfig);
    if (!runtimeState.sttUnsubscribe) {
      runtimeState.sttUnsubscribe = stt.onEvent(handleSTTEvent);
    }
  }

  async function reconnectSTT(): Promise<void> {
    return reconnectSTTHelper(
      runtimeState,
      maxReconnectAttempts,
      reconnectDelayMs,
      trace,
      reportError,
      ensureSTTConnected,
      (traceEvent) =>
        flushBufferedAudio(runtimeState, stt, trace, reportError, traceEvent),
      setVoiceState,
    );
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
      setVoiceState,
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
        pendingBufferedAudioChunks: runtimeState.pendingAudioChunks.length,
        isInitializing: runtimeState.isInitializing,
      });

      clearAutoRestartTimeout();

      if (runtimeState.state === 'processing') {
        abortActiveProcessing();
      }

      runtimeState.isInitializing = true;
      await ensureSTTConnected();
      if (runtimeState.destroyed) {
        return;
      }
      resetTurnTracking(runtimeState);
      setVoiceState('listening');

      flushBufferedAudio(
        runtimeState,
        stt,
        trace,
        reportError,
        'stt.buffered_audio.sent',
      );
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
      pendingBufferedAudioChunks: runtimeState.pendingAudioChunks.length,
    });

    // Reuse the existing pending-finalization path so providers that synchronously flush a final
    // transcript from endStream() finalize that turn exactly once before the manual fallback runs.
    runtimeState.pendingFinalFromVAD = true;
    stt.endStream();
    const transcriptToFinalize =
      runtimeState.currentTranscript || runtimeState.accumulatedTranscript;
    runtimeState.pendingAudioChunks.length = 0;
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
      setVoiceState('idle');
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

    setVoiceState('speaking');

    if (!tts.isConnected()) {
      await ensureTTSConnected();
    }

    if (runtimeState.state !== 'speaking') return;

    const speakOptions: { voice?: string } = {};
    if (voice) {
      speakOptions.voice = voice;
    }
    trace('tts.speak.dispatched', {
      provider: tts.name,
      requestedVoice: speakOptions.voice ?? null,
    });
    tts.speak(text, speakOptions);
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
    clearPendingFinalization(runtimeState);
    abortActiveProcessing();
    runtimeState.pendingAudioChunks.length = 0;
    cleanupProviders();
    listeners.stateChange.clear();
    listeners.transcript.clear();
    listeners.vad.clear();
    listeners.audioOutput.clear();
  }

  return {
    getVoiceState: () => runtimeState.state,
    warmup(): Promise<void> {
      return Promise.all([ensureSTTConnected(), ensureTTSConnected()]).then(
        () => undefined,
      );
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
    shouldAutoRestart(): boolean {
      return autoRestartListening && runtimeState.state === 'idle';
    },
    sendAudioChunk(chunk: AudioChunk): void {
      if (runtimeState.destroyed) {
        return;
      }
      if (runtimeState.isInitializing || runtimeState.state === 'idle') {
        bufferAudioChunk(
          runtimeState,
          maxPendingAudioChunks,
          reportError,
          trace,
          chunk,
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
        trace('stt.audio.dropped', {
          bytes: chunk.data.length,
          sampleRate: chunk.sampleRate,
          encoding: chunk.encoding,
          state: runtimeState.state,
        });
        return;
      }

      if (stt.isConnected()) {
        trace('stt.audio.sent', {
          bytes: chunk.data.length,
          sampleRate: chunk.sampleRate,
          encoding: chunk.encoding,
        });
        stt.sendAudio(chunk);
        return;
      }

      bufferAudioChunk(
        runtimeState,
        maxPendingAudioChunks,
        reportError,
        trace,
        chunk,
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
