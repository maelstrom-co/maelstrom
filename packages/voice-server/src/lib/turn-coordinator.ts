import type { TelemetrySink } from '@maelstrom-co/telemetry';
import type { MaelstromResponse, SessionId } from '@maelstrom-co/protocol';
import { handleTranscriptGraceExpiryTerminalBranches } from './transcript-grace.js';
import {
  createInitialTurnCoordinatorState,
  type TurnCoordinatorState,
} from './turn-coordinator.state.js';
import {
  emitVoiceSessionTelemetryEvent,
  recordVoiceSessionTelemetryTiming,
} from './telemetry.js';
import type {
  TranscriptionResult,
  VoiceSessionCallbacks,
  VoiceSessionIntentRequestBuilder,
  VoiceSessionIntentRequestOptions,
  VoiceSessionState,
} from './types.js';
import type { VoiceSessionEventSink } from './voice-session-events.contract.js';

// WHY: Three consecutive grace expiries with no transcript finalization is the point where the
// runtime stops treating the condition as ordinary STT/VAD latency variance and starts surfacing a
// degraded STT-pipeline signal. Any successful finalization resets the streak. Tune alongside
// `transcriptGraceMs` because a longer grace window naturally tolerates more provider flush lag.
const repeatedGraceExpiryErrorThreshold = 3;
const autoRestartDelayMs = 500;

type NotifyCallbackSafely = <T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  traceEvent: string,
  ...args: T
) => void;

type EmitStateTelemetry = (
  previousState: VoiceSessionState,
  newState: VoiceSessionState,
) => void;

type TurnTelemetrySource = 'stt' | 'explicit';

type TurnTelemetryOutcome = 'completed' | 'aborted' | 'superseded' | 'errored';

export type TurnCoordinatorDeps = {
  sessionId: SessionId;
  intentBoundary:
    | {
        buildChartRequest: VoiceSessionIntentRequestBuilder;
        processIntent: {
          process: (
            request: Awaited<ReturnType<VoiceSessionIntentRequestBuilder>>,
            signal?: AbortSignal,
          ) => Promise<MaelstromResponse>;
        };
      }
    | undefined;
  autoRestartListening: boolean;
  transcriptGraceMs: number;
  interimResults: boolean;
  isDestroyed: () => boolean;
  trace: (event: string, details?: Record<string, unknown>) => void;
  reportError: (error: unknown) => void;
  reportAsyncFailure: (
    traceEvent: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
  notifyCallbackSafely: NotifyCallbackSafely;
  telemetry?: TelemetrySink;
  eventSink: Pick<
    VoiceSessionEventSink,
    'emitTranscript' | 'emitVoiceStateChange'
  >;
  emitStateTelemetry?: EmitStateTelemetry;
  callbacks: VoiceSessionCallbacks;
  // lazy refs to break circular deps — call these at invocation time, not at creation time
  getSttStartListening: () => () => Promise<void>;
  getTTSStop: () => (nextState?: VoiceSessionState) => void;
  getTTSSpeak: () => (text: string, opts: { voice?: string }) => Promise<void>;
  getSttEndStream: () => () => void;
  getVADClearPendingFinalization: () => () => void;
  getVADIsPendingFinalFromVAD: () => () => boolean;
};

export function createTurnCoordinator(deps: TurnCoordinatorDeps) {
  const {
    sessionId,
    intentBoundary,
    autoRestartListening,
    transcriptGraceMs,
    interimResults,
    isDestroyed,
    trace,
    reportError,
    reportAsyncFailure,
    notifyCallbackSafely,
    telemetry,
    eventSink,
    emitStateTelemetry,
    callbacks,
    getSttStartListening,
    getTTSStop,
    getTTSSpeak,
    getSttEndStream,
    getVADClearPendingFinalization,
    getVADIsPendingFinalFromVAD,
  } = deps;

  const state: TurnCoordinatorState = createInitialTurnCoordinatorState();
  let isInRepeatedGraceExpiryDegradedMode = false;

  function getVoiceState(): VoiceSessionState {
    return state.state;
  }

  function setVoiceState(newState: VoiceSessionState): void {
    if (isDestroyed()) return;
    if (state.state === newState) return;

    const previousState = state.state;
    trace('voice.state_change', {
      previousState,
      nextState: newState,
    });
    state.state = newState;
    eventSink.emitVoiceStateChange(newState);
    try {
      emitStateTelemetry?.(previousState, newState);
    } catch {
      // WHY: State-change telemetry is best-effort observability. Listener/callback ordering and the
      // state transition itself must remain authoritative even if a telemetry adapter throws.
    }

    if (
      newState === 'idle' &&
      autoRestartListening &&
      previousState === 'speaking'
    ) {
      if (state.suppressNextAutoRestart) {
        state.suppressNextAutoRestart = false;
        return;
      }

      state.autoRestartTimeout = setTimeout(() => {
        if (!isDestroyed() && state.state === 'idle') {
          void getSttStartListening()().catch((error) => {
            reportAsyncFailure('stt.auto_restart.failed', error);
          });
        }
      }, autoRestartDelayMs);
    }
  }

  function getTurnState() {
    return {
      currentTranscript: state.currentTranscript,
      accumulatedTranscript: state.accumulatedTranscript,
      hasEmittedFinal: state.hasEmittedFinal,
      hasReceivedSpeech: state.hasReceivedSpeech,
      hasSentAudioForTurn: state.hasSentAudioForTurn,
      suppressIncomingAudio: state.suppressIncomingAudio,
      pendingFinalFromVAD: getVADIsPendingFinalFromVAD()(),
    };
  }

  function markHasSentAudioForTurn(): void {
    state.hasSentAudioForTurn = true;
  }

  function setSuppressIncomingAudio(value: boolean): void {
    state.suppressIncomingAudio = value;
  }

  function clearAutoRestartTimeout(): void {
    if (state.autoRestartTimeout) {
      clearTimeout(state.autoRestartTimeout);
      state.autoRestartTimeout = null;
    }
  }

  function emitTurnStartedTelemetry(source: TurnTelemetrySource): void {
    emitVoiceSessionTelemetryEvent(telemetry, {
      name: 'maelstrom.voice_server.turn.started',
      attributes: {
        source,
      },
    });
  }

  function emitTurnCompletedTelemetry(input: {
    outcome: TurnTelemetryOutcome;
    source: TurnTelemetrySource;
    speakResponse: boolean;
    startedAt: number;
  }): void {
    emitVoiceSessionTelemetryEvent(telemetry, {
      name: 'maelstrom.voice_server.turn.completed',
      attributes: {
        source: input.source,
        outcome: input.outcome,
      },
    });

    recordVoiceSessionTelemetryTiming(telemetry, {
      name: 'maelstrom.voice_server.intent.duration',
      duration: performance.now() - input.startedAt,
      attributes: {
        outcome: input.outcome,
        speakResponse: input.speakResponse,
      },
    });
  }

  function resolveTurnOutcome(
    abortController: AbortController,
  ): TurnTelemetryOutcome {
    if (abortController.signal.aborted) {
      return state.activeProcessAbortController === abortController ||
        state.activeProcessAbortController === null ||
        isDestroyed()
        ? 'aborted'
        : 'superseded';
    }

    if (isDestroyed()) {
      return 'aborted';
    }

    return state.activeProcessAbortController === abortController
      ? 'errored'
      : 'superseded';
  }

  function abortActiveProcessing(): void {
    state.activeProcessAbortController?.abort();
    state.activeProcessAbortController = null;
  }

  function clearPendingFinalization(): void {
    // WHY: Every new speech_start, manual stop, or completed finalization must cancel the grace
    // timer so stale VAD boundaries cannot finalize a newer turn. VAD debounce is owned by
    // VADCoordinator and is not touched here.
    if (state.transcriptGraceTimeout) {
      clearTimeout(state.transcriptGraceTimeout);
      state.transcriptGraceTimeout = null;
    }
  }

  function resetTurnTracking(): void {
    // WHY: Turn assembly state must reset as one unit before listening resumes, otherwise stale text
    // from a previous utterance could leak into the next provider-final or VAD-final result.
    state.suppressIncomingAudio = false;
    state.hasSentAudioForTurn = false;
    state.hasReceivedSpeech = false;
    state.hasEmittedFinal = false;
    state.currentTranscript = '';
    state.accumulatedTranscript = '';
    clearPendingFinalization();
    getVADClearPendingFinalization()();
  }

  function updateTranscriptState(result: TranscriptionResult): void {
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

  function createForwardedTranscriptResult(
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

  function forwardTranscriptResult(result: TranscriptionResult): void {
    // WHY: Listener subscriptions are a lower-level observability surface, so they always see the
    // forwarded transcript event. The optional callback keeps its historical behavior and can suppress
    // interim noise when the host only wants stable user-visible updates.
    const listenerCount = eventSink.emitTranscript(result, {
      includeCallback: interimResults || result.isFinal,
    });
    trace('stt.transcript.forwarded', {
      textLength: result.text.length,
      preview: result.text.slice(0, 80),
      isFinal: result.isFinal,
      listenerCount,
      hasOnTranscriptCallback: Boolean(callbacks.onTranscript),
    });
  }

  function shouldReportRepeatedGraceExpiryDegradedMode(): boolean {
    if (isInRepeatedGraceExpiryDegradedMode) {
      return false;
    }

    if (state.consecutiveGraceExpiries < repeatedGraceExpiryErrorThreshold) {
      return false;
    }

    isInRepeatedGraceExpiryDegradedMode = true;
    return true;
  }

  function finalizeTranscript(text: string): {
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
    eventSink.emitTranscript(finalResult, { includeCallback: true });

    const startedProcessing = processTranscript(text);

    // WHY: The repeated-grace threshold only tracks consecutive expiries that failed to produce
    // any final transcript. A successful finalization resets both the counter and degraded-mode
    // flag so later turns start from a clean baseline instead of inheriting prior grace failures.
    isInRepeatedGraceExpiryDegradedMode = false;
    state.consecutiveGraceExpiries = 0;

    return { emitted: true, startedProcessing };
  }

  function startTranscriptGrace(): void {
    if (state.hasEmittedFinal) {
      return;
    }

    if (state.transcriptGraceTimeout) {
      clearTimeout(state.transcriptGraceTimeout);
      state.transcriptGraceTimeout = null;
    }

    trace('stt.transcript_grace.started', {
      transcriptGraceMs,
      pendingFinalFromVAD: getVADIsPendingFinalFromVAD()(),
      currentTranscriptLength: state.currentTranscript.length,
      accumulatedTranscriptLength: state.accumulatedTranscript.length,
    });

    state.transcriptGraceTimeout = setTimeout(() => {
      state.transcriptGraceTimeout = null;

      if (isDestroyed()) {
        return;
      }

      if (
        handleTranscriptGraceExpiryTerminalBranches(
          {
            currentTranscript: state.currentTranscript,
            accumulatedTranscript: state.accumulatedTranscript,
            hasEmittedFinal: state.hasEmittedFinal,
          },
          trace,
          () => {
            clearPendingFinalization();
            getVADClearPendingFinalization()();
          },
          finalizeTranscript,
        )
      ) {
        return;
      }

      trace('stt.transcript_grace.expired', {
        transcriptGraceMs,
        pendingFinalFromVAD: getVADIsPendingFinalFromVAD()(),
      });

      clearPendingFinalization();
      getVADClearPendingFinalization()();

      if (state.state === 'listening') {
        state.consecutiveGraceExpiries += 1;

        if (shouldReportRepeatedGraceExpiryDegradedMode()) {
          reportError(
            new Error(
              `Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=${state.consecutiveGraceExpiries}, threshold=${repeatedGraceExpiryErrorThreshold}, transcriptGraceMs=${transcriptGraceMs})`,
            ),
          );
        }

        setVoiceState('idle');
      }
    }, transcriptGraceMs);
  }

  function emitFinalTranscript(): void {
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

    // WHY: Only clear the VAD debounce flag here, not the grace timer. A prior empty
    // emitFinalTranscript call may have armed the grace timer; if we cancel it now, the timer
    // callback can never fire to emit `stt.transcript_grace.already_finalized`. The grace timer
    // is harmless: handleTranscriptGraceExpiryTerminalBranches returns early (emitting that trace
    // event) when hasEmittedFinal is already true, so no duplicate processing occurs.
    getVADClearPendingFinalization()();
    finalizeTranscript(transcriptToFinalize);
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
    if (!intentBoundary || isDestroyed()) {
      return undefined;
    }

    const source: TurnTelemetrySource =
      options.traceDetails?.explicitRequest === true ? 'explicit' : 'stt';
    const speakResponse = options.speakResponse !== false;
    const turnStartedAt = performance.now();
    let turnTelemetryEmitted = false;
    let turnOutcome: TurnTelemetryOutcome | undefined;

    function emitTurnTelemetryIfNeeded() {
      if (turnTelemetryEmitted || !turnOutcome) {
        return;
      }

      turnTelemetryEmitted = true;
      emitTurnCompletedTelemetry({
        outcome: turnOutcome,
        source,
        speakResponse,
        startedAt: turnStartedAt,
      });
    }

    emitTurnStartedTelemetry(source);
    clearAutoRestartTimeout();

    if (state.state === 'speaking') {
      // WHY: A fresh request that arrives mid-speech must settle the active spoken turn before the
      // runtime advances into the next processing turn. That preserves deterministic interruption
      // semantics: `onSpeechStopped(false)` belongs to the old turn, and the new request owns the
      // following `processing` state rather than racing a partially torn-down TTS lifecycle.
      getTTSStop()('processing');
    }

    setVoiceState('processing');
    const abortController = new AbortController();
    const previousAbortController = state.activeProcessAbortController;
    state.activeProcessAbortController = abortController;
    previousAbortController?.abort();

    trace('intent.processing.started', {
      ...options.traceDetails,
    });

    try {
      const request = await createRequest();

      // WHY: Request building and intent execution can overlap with a newer turn. The identity check
      // ensures only the latest generation is allowed to emit results or mutate runtime state.
      if (
        isDestroyed() ||
        abortController.signal.aborted ||
        state.activeProcessAbortController !== abortController
      ) {
        turnOutcome = resolveTurnOutcome(abortController);
        emitTurnTelemetryIfNeeded();
        return undefined;
      }

      const response = await Promise.resolve().then(() =>
        intentBoundary.processIntent.process(request, abortController.signal),
      );

      if (
        isDestroyed() ||
        state.activeProcessAbortController !== abortController
      ) {
        turnOutcome = resolveTurnOutcome(abortController);
        emitTurnTelemetryIfNeeded();
        return undefined;
      }

      trace('intent.processing.completed', {
        requestId: response.requestId,
        replyLength: response.userMessage.length,
      });

      turnOutcome = 'completed';
      emitTurnTelemetryIfNeeded();

      if (response.userMessage && options.speakResponse !== false) {
        await getTTSSpeak()(response.userMessage, {});
      } else if (state.state === 'processing') {
        setVoiceState('idle');
      }

      return response;
    } catch (error: unknown) {
      if (abortController.signal.aborted) {
        turnOutcome = resolveTurnOutcome(abortController);
        emitTurnTelemetryIfNeeded();
        trace('intent.processing.aborted');
        return undefined;
      }

      turnOutcome = 'errored';
      emitTurnTelemetryIfNeeded();
      reportError(error);
      if (
        state.activeProcessAbortController === abortController &&
        state.state === 'processing'
      ) {
        setVoiceState('idle');
      }
      return undefined;
    } finally {
      if (state.activeProcessAbortController === abortController) {
        state.activeProcessAbortController = null;
      }

      emitTurnTelemetryIfNeeded();
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

  function processRequest(
    request: Awaited<ReturnType<VoiceSessionIntentRequestBuilder>>,
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
  }

  function interrupt(): void {
    if (isDestroyed()) return;
    clearAutoRestartTimeout();
    clearPendingFinalization();
    getVADClearPendingFinalization()();
    abortActiveProcessing();

    if (state.state === 'speaking') {
      state.suppressNextAutoRestart = true;
      getTTSStop()();
      notifyCallbackSafely(
        callbacks.onInterrupt,
        'callback.onInterrupt.failed',
        'user',
      );
      return;
    }

    if (state.state === 'processing') {
      setVoiceState('idle');
      notifyCallbackSafely(
        callbacks.onInterrupt,
        'callback.onInterrupt.failed',
        'user',
      );
      return;
    }

    if (state.state === 'listening') {
      getSttEndStream()();
      setVoiceState('idle');
      notifyCallbackSafely(
        callbacks.onInterrupt,
        'callback.onInterrupt.failed',
        'user',
      );
    }
  }

  function destroy(): void {
    clearAutoRestartTimeout();
    clearPendingFinalization();
    abortActiveProcessing();
  }

  return {
    destroy,
    getVoiceState,
    setVoiceState,
    getTurnState,
    markHasSentAudioForTurn,
    setSuppressIncomingAudio,
    updateTranscriptState,
    createForwardedTranscriptResult,
    forwardTranscriptResult,
    emitFinalTranscript,
    finalizeTranscript,
    clearPendingFinalization,
    resetTurnTracking,
    startTranscriptGrace,
    processTranscript,
    executeIntentRequest,
    processRequest,
    interrupt,
    clearAutoRestartTimeout,
    abortActiveProcessing,
    isDestroyed,
  };
}
