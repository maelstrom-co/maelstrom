import type { createAudioBufferQueue } from './audio-buffer-queue.js';
import {
  createInitialSTTSessionManagerState,
  deriveSTTSessionManagerPhase,
  type STTSessionManagerState,
} from './stt-session-manager.state.js';
import type {
  AudioChunk,
  STTError,
  STTEvent,
  STTProvider,
  SttCircuitStatus,
  TranscriptionResult,
  VoiceDisconnectedEvent,
  VoiceProviderErrorKind,
  VoiceSessionState,
} from './types.js';
import type { VoiceSessionEventSink } from './voice-session-events.contract.js';

const reconnectStabilityWindowMs = 5000;
const serverRetryAttemptBudget = 1;

type STTReconnectTrigger =
  | { type: 'disconnected'; clean: false; message: string }
  | { type: 'error'; error: STTError };

type ReconnectFailureDirective = {
  retryable: boolean;
  attemptBudget: number;
  kind: VoiceProviderErrorKind | 'generic';
};

type AudioBufferQueue = ReturnType<typeof createAudioBufferQueue>;

type STTSessionManagerConfig = {
  language?: string;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  reconnectBackoffMultiplier: number;
  reconnectJitterMs: number;
  circuitBreakerTimeoutMs: number;
};

type STTSessionManagerRuntimeBridge = {
  isDestroyed: () => boolean;
  getVoiceState: () => VoiceSessionState;
  setVoiceState: (state: VoiceSessionState) => void;
  trace: (event: string, details?: Record<string, unknown>) => void;
  reportError: (error: unknown) => void;
  clearAutoRestartTimeout: () => void;
  abortActiveProcessing: () => void;
};

type STTSessionManagerTurnAccess = {
  resetTurnTracking: () => void;
  getTurnState: () => {
    currentTranscript: string;
    accumulatedTranscript: string;
    hasEmittedFinal: boolean;
    hasReceivedSpeech: boolean;
    hasSentAudioForTurn: boolean;
    pendingFinalFromVAD: boolean;
    suppressIncomingAudio: boolean;
  };
  setPendingFinalFromVAD: (value: boolean) => void;
  setSuppressIncomingAudio: (value: boolean) => void;
  markHasSentAudioForTurn: () => void;
  clearPendingFinalization: () => void;
  startTranscriptGrace: () => void;
  finalizeTranscript: (text: string) => {
    emitted: boolean;
    startedProcessing: boolean;
  };
  updateTranscriptState: (result: TranscriptionResult) => void;
  emitFinalTranscript: () => void;
  createForwardedTranscriptResult: (
    result: TranscriptionResult,
  ) => TranscriptionResult;
  forwardTranscriptResult: (result: TranscriptionResult) => void;
};

type STTSessionManagerEventBus = Pick<
  VoiceSessionEventSink,
  'emitSttCircuitStatusChange'
>;

export interface CreateSTTSessionManagerCallbacks
  extends STTSessionManagerConfig,
    STTSessionManagerRuntimeBridge,
    STTSessionManagerTurnAccess {
  eventBus: STTSessionManagerEventBus;
}

export interface STTSessionManager {
  connect: (operation?: 'start_listening' | 'warmup') => Promise<void>;
  disconnect: () => Promise<void>;
  endStream: () => void;
  forceReconnect: () => Promise<void>;
  getCircuitStatus: () => SttCircuitStatus;
  sendAudio: (chunk: AudioChunk, _durationMs?: number) => void;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
}

interface SttDisconnectSuppressionController {
  isSuppressed(): boolean;
  suppress(): () => void;
}

function createSttDisconnectSuppressionController(): SttDisconnectSuppressionController {
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

function normalizeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error), { cause: error });
}

function createReconnectExhaustedError(errors: Error[]): AggregateError {
  const lastError = errors.at(-1);

  return new AggregateError(errors, 'STT connection lost after max retries', {
    cause: lastError,
  });
}

function getReconnectErrorKind(
  error: Error,
): VoiceProviderErrorKind | 'generic' {
  const kind = (error as { kind?: unknown }).kind;

  return kind === 'auth' ||
    kind === 'quota' ||
    kind === 'transport' ||
    kind === 'parse' ||
    kind === 'server' ||
    kind === 'unknown'
    ? kind
    : 'generic';
}

function getReconnectFailureDirective(
  error: Error,
  maxReconnectAttempts: number,
): ReconnectFailureDirective {
  const kind = getReconnectErrorKind(error);

  switch (kind) {
    case 'auth':
    case 'quota':
      return {
        retryable: false,
        attemptBudget: 0,
        kind,
      };

    case 'server':
      return {
        retryable: true,
        attemptBudget: serverRetryAttemptBudget,
        kind,
      };

    case 'transport':
    case 'parse':
    case 'unknown':
    case 'generic':
      return {
        retryable: true,
        attemptBudget: maxReconnectAttempts,
        kind,
      };

    default: {
      const exhaustiveKind: never = kind;

      throw new Error(`Unhandled reconnect error kind: ${exhaustiveKind}`);
    }
  }
}

function shouldForceReconnectTransport(trigger: STTReconnectTrigger): boolean {
  return trigger.type === 'error';
}

function calculateReconnectDelayMs(
  attempt: number,
  reconnectDelayMs: number,
  reconnectBackoffMultiplier: number,
  maxReconnectDelayMs: number,
  reconnectJitterMs: number,
): number {
  const exponentialDelay = Math.min(
    maxReconnectDelayMs,
    reconnectDelayMs * reconnectBackoffMultiplier ** Math.max(0, attempt - 1),
  );
  const maxBoundedJitter = Math.min(
    reconnectJitterMs,
    Math.max(0, maxReconnectDelayMs - exponentialDelay),
  );
  const boundedJitter = Math.random() * maxBoundedJitter;

  return Math.min(maxReconnectDelayMs, exponentialDelay + boundedJitter);
}

function isReconnectableState(state: VoiceSessionState): boolean {
  return state === 'listening' || state === 'processing';
}

function isDisconnectedEvent(event: STTEvent): event is VoiceDisconnectedEvent {
  return (
    event.type === 'disconnected' &&
    'clean' in event &&
    'reason' in event &&
    'message' in event &&
    typeof event.clean === 'boolean' &&
    typeof event.reason === 'string' &&
    typeof event.message === 'string'
  );
}

function isRecoverableIdleDisconnect(event: VoiceDisconnectedEvent): boolean {
  if (!event.clean) {
    return false;
  }

  const normalizedMessage = event.message.trim().toLowerCase();

  return (
    normalizedMessage.includes('idle') ||
    normalizedMessage.includes('inactivity') ||
    normalizedMessage.includes('no audio') ||
    normalizedMessage.includes('timeout')
  );
}

export function createSTTSessionManager(
  stt: STTProvider,
  audioBufferQueue: AudioBufferQueue,
  callbacks: CreateSTTSessionManagerCallbacks,
): STTSessionManager {
  let state = createInitialSTTSessionManagerState();
  const disconnectSuppression = createSttDisconnectSuppressionController();

  function isForegroundStarting(): boolean {
    return state.foreground.kind === 'starting';
  }

  function getCircuitStatus(): SttCircuitStatus {
    return state.circuit.kind;
  }

  function replaceLifecycleState(next: {
    foreground?: typeof state.foreground;
    reconnect?: typeof state.reconnect;
    circuit?: typeof state.circuit;
  }): void {
    const foreground = next.foreground ?? state.foreground;
    const reconnect = next.reconnect ?? state.reconnect;
    const circuit = next.circuit ?? state.circuit;

    state = {
      ...state,
      phase: deriveSTTSessionManagerPhase({ foreground, reconnect, circuit }),
      foreground,
      reconnect,
      circuit,
    } as STTSessionManagerState;
  }

  function clearReconnectResetTimeout() {
    if (state.reconnect.resetTimeout) {
      clearTimeout(state.reconnect.resetTimeout);
      state.reconnect.resetTimeout = null;
    }
  }

  function clearReconnectDelayTimeout() {
    if (state.reconnect.kind === 'waiting' && state.reconnect.delayTimeout) {
      clearTimeout(state.reconnect.delayTimeout);
      state.reconnect.delayTimeout = null;
    }

    if (state.reconnect.kind === 'waiting' && state.reconnect.delayResolve) {
      const resolve = state.reconnect.delayResolve;
      state.reconnect.delayResolve = null;
      resolve();
    }
  }

  function clearSttCircuitCooldownTimeout() {
    if (state.circuit.kind === 'open' && state.circuit.cooldownTimeout) {
      clearTimeout(state.circuit.cooldownTimeout);
      state.circuit.cooldownTimeout = null;
    }
  }

  function setSttCircuitStatus(status: SttCircuitStatus) {
    if (callbacks.isDestroyed() || getCircuitStatus() === status) {
      return;
    }

    callbacks.trace('stt.circuit.status_changed', {
      previousStatus: getCircuitStatus(),
      nextStatus: status,
      reconnectDelayMs: callbacks.reconnectDelayMs,
      maxReconnectDelayMs: callbacks.maxReconnectDelayMs,
      reconnectBackoffMultiplier: callbacks.reconnectBackoffMultiplier,
      reconnectJitterMs: callbacks.reconnectJitterMs,
      circuitBreakerTimeoutMs: callbacks.circuitBreakerTimeoutMs,
    });

    replaceLifecycleState({
      circuit:
        status === 'open'
          ? {
              kind: 'open',
              cooldownTimeout:
                state.circuit.kind === 'open'
                  ? state.circuit.cooldownTimeout
                  : null,
            }
          : { kind: status },
    });
    callbacks.eventBus.emitSttCircuitStatusChange(status);
  }

  function closeSttCircuit() {
    clearSttCircuitCooldownTimeout();
    setSttCircuitStatus('closed');
  }

  function openSttCircuit() {
    clearSttCircuitCooldownTimeout();
    setSttCircuitStatus('open');

    if (state.circuit.kind !== 'open') {
      return;
    }

    state.circuit.cooldownTimeout = setTimeout(() => {
      if (state.circuit.kind === 'open') {
        state.circuit.cooldownTimeout = null;
      }

      if (callbacks.isDestroyed() || getCircuitStatus() !== 'open') {
        return;
      }

      setSttCircuitStatus('half_open');
    }, callbacks.circuitBreakerTimeoutMs);
  }

  function scheduleReconnectReset() {
    clearReconnectResetTimeout();
    state.reconnect.resetTimeout = setTimeout(() => {
      state.reconnect.attempts = 0;
      state.reconnect.resetTimeout = null;
    }, reconnectStabilityWindowMs);
  }

  function resetReconnectLifecycle() {
    clearReconnectDelayTimeout();
    clearReconnectResetTimeout();
    state.reconnect.attempts = 0;
  }

  function replayBufferedAudio(traceEvent: string) {
    audioBufferQueue.replay({
      stt,
      traceEvent,
      getVoiceState: callbacks.getVoiceState,
      markHasSentAudioForTurn: callbacks.markHasSentAudioForTurn,
    });
  }

  function getInitialAttemptBudget(trigger: STTReconnectTrigger): number {
    if (getCircuitStatus() === 'half_open') {
      return 1;
    }

    if (trigger.type === 'disconnected') {
      return callbacks.maxReconnectAttempts;
    }

    return getReconnectFailureDirective(
      trigger.error,
      callbacks.maxReconnectAttempts,
    ).attemptBudget;
  }

  function failReconnectExhausted(reconnectErrors: Error[]) {
    callbacks.trace('stt.reconnect.exhausted', {
      attempts: state.reconnect.attempts,
      state: callbacks.getVoiceState(),
      pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
      circuitStatus: getCircuitStatus(),
    });
    openSttCircuit();
    audioBufferQueue.flushDropEvent();
    callbacks.reportError(createReconnectExhaustedError(reconnectErrors));
    audioBufferQueue.reset();
    callbacks.setVoiceState('idle');
    resetReconnectLifecycle();
  }

  function failReconnectTerminally(error: Error) {
    audioBufferQueue.flushDropEvent();
    callbacks.reportError(error);
    audioBufferQueue.reset();
    callbacks.setVoiceState('idle');
    resetReconnectLifecycle();
  }

  function handleSTTEvent(event: STTEvent) {
    if (event.type === 'disconnected' && disconnectSuppression.isSuppressed()) {
      return;
    }

    switch (event.type) {
      case 'transcript': {
        const transcriptText = event.result.text.trim();
        const turnState = callbacks.getTurnState();

        callbacks.trace('stt.transcript.received', {
          textLength: transcriptText.length,
          preview: transcriptText.slice(0, 80),
          isFinal: event.result.isFinal,
          confidence: event.result.confidence ?? null,
          language: event.result.language ?? null,
          durationInSeconds: event.result.durationInSeconds ?? null,
          pendingFinalFromVAD: turnState.pendingFinalFromVAD,
        });
        if (!transcriptText) {
          break;
        }

        if (callbacks.getVoiceState() === 'idle' || turnState.hasEmittedFinal) {
          callbacks.trace('stt.transcript.ignored_after_turn_closed', {
            textLength: transcriptText.length,
            preview: transcriptText.slice(0, 80),
            isFinal: event.result.isFinal,
            state: callbacks.getVoiceState(),
            pendingFinalFromVAD: turnState.pendingFinalFromVAD,
            hasEmittedFinal: turnState.hasEmittedFinal,
          });
          break;
        }

        callbacks.updateTranscriptState({
          ...event.result,
          text: transcriptText,
        });

        if (callbacks.getTurnState().pendingFinalFromVAD) {
          callbacks.emitFinalTranscript();
          break;
        }

        callbacks.forwardTranscriptResult(
          callbacks.createForwardedTranscriptResult({
            ...event.result,
            text: transcriptText,
          }),
        );
        break;
      }

      case 'error':
        callbacks.trace('stt.error', {
          kind: event.error.kind,
          message: event.error.message,
          provider: event.error.provider,
        });
        callbacks.reportError(event.error);

        if (!isReconnectableState(callbacks.getVoiceState())) {
          callbacks.setVoiceState('idle');
          break;
        }

        if (event.error.kind === 'auth' || event.error.kind === 'quota') {
          callbacks.setVoiceState('idle');
          break;
        }

        void reconnectSTT({
          type: 'error',
          error: event.error,
        });
        break;

      case 'disconnected': {
        if (!isDisconnectedEvent(event)) {
          break;
        }

        callbacks.trace('stt.disconnected', {
          state: callbacks.getVoiceState(),
          clean: event.clean,
          pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
        });
        if (
          isReconnectableState(callbacks.getVoiceState()) &&
          (event.clean === false || isRecoverableIdleDisconnect(event))
        ) {
          void reconnectSTT({
            type: 'disconnected',
            clean: false,
            message: event.message,
          });
        }
        break;
      }
    }
  }

  async function ensureSTTConnected() {
    if (callbacks.isDestroyed()) {
      return;
    }
    if (stt.isConnected()) {
      return;
    }

    const connectConfig: { language?: string } = {};
    if (callbacks.language) {
      connectConfig.language = callbacks.language;
    }

    callbacks.trace('stt.connecting', {
      provider: stt.name,
      language: connectConfig.language ?? null,
      circuitStatus: getCircuitStatus(),
    });
    await stt.connect(connectConfig);
    if (!state.sttUnsubscribe) {
      state.sttUnsubscribe = stt.onEvent(handleSTTEvent);
    }
  }

  async function connectForegroundSTT(
    operation: 'start_listening' | 'warmup',
  ): Promise<void> {
    if (getCircuitStatus() === 'open') {
      callbacks.trace('stt.connect.skipped', {
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
      if (getCircuitStatus() === 'half_open') {
        openSttCircuit();
      }

      throw error;
    }

    if (getCircuitStatus() === 'half_open') {
      closeSttCircuit();
    }
  }

  async function connectTransport(forceReconnect = false) {
    if (forceReconnect && stt.isConnected()) {
      const releaseDisconnectSuppression = disconnectSuppression.suppress();

      try {
        await stt.disconnect();
      } finally {
        releaseDisconnectSuppression();
      }
    }

    await ensureSTTConnected();
  }

  async function reconnectSTT(trigger: STTReconnectTrigger): Promise<void> {
    if (state.reconnect.kind === 'waiting') {
      return state.reconnect.promise;
    }

    if (getCircuitStatus() === 'open') {
      callbacks.trace('stt.reconnect.skipped', {
        reason: 'circuit_open',
        triggerType: trigger.type,
        state: callbacks.getVoiceState(),
        pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
      });
      return Promise.resolve();
    }

    const waitingReconnectState = {
      kind: 'waiting' as const,
      attempts: state.reconnect.attempts,
      promise: Promise.resolve(),
      delayResolve: null,
      delayTimeout: null,
      resetTimeout: state.reconnect.resetTimeout,
    };

    replaceLifecycleState({ reconnect: waitingReconnectState });

    const reconnectPromise = (async () => {
      clearReconnectResetTimeout();
      state.reconnect.attempts = 0;
      const reconnectErrors: Error[] = [];
      const isCircuitProbe = getCircuitStatus() === 'half_open';
      let attemptBudget = getInitialAttemptBudget(trigger);
      let forceReconnectTransport = shouldForceReconnectTransport(trigger);
      let reconnectAttemptsThisCycle = 0;

      try {
        if (attemptBudget <= 0) {
          callbacks.trace('stt.reconnect.skipped', {
            reason: 'not_retryable',
            triggerType: trigger.type,
            state: callbacks.getVoiceState(),
            circuitStatus: getCircuitStatus(),
          });
          resetReconnectLifecycle();
          return;
        }

        while (
          !callbacks.isDestroyed() &&
          isReconnectableState(callbacks.getVoiceState())
        ) {
          const attempt = reconnectAttemptsThisCycle + 1;
          const delayMs = calculateReconnectDelayMs(
            attempt,
            callbacks.reconnectDelayMs,
            callbacks.reconnectBackoffMultiplier,
            callbacks.maxReconnectDelayMs,
            callbacks.reconnectJitterMs,
          );

          callbacks.trace('stt.reconnect.attempt', {
            attempt,
            attemptBudget,
            state: callbacks.getVoiceState(),
            delayMs,
            circuitStatus: getCircuitStatus(),
            isCircuitProbe,
            pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
          });

          reconnectAttemptsThisCycle = attempt;
          state.reconnect.attempts = attempt;
          await new Promise<void>((resolve) => {
            if (state.reconnect.kind !== 'waiting') {
              resolve();
              return;
            }

            const reconnectState = state.reconnect;
            reconnectState.delayResolve = resolve;
            reconnectState.delayTimeout = setTimeout(() => {
              if (state.reconnect.kind === 'waiting') {
                state.reconnect.delayTimeout = null;
                state.reconnect.delayResolve = null;
              }
              resolve();
            }, delayMs);
          });

          if (
            callbacks.isDestroyed() ||
            !isReconnectableState(callbacks.getVoiceState())
          ) {
            resetReconnectLifecycle();
            return;
          }

          try {
            await connectTransport(forceReconnectTransport);
            callbacks.trace('stt.reconnect.succeeded', {
              pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
              state: callbacks.getVoiceState(),
              attempt,
              attemptBudget,
              circuitStatus: getCircuitStatus(),
              isCircuitProbe,
            });

            if (isCircuitProbe) {
              closeSttCircuit();
            }

            scheduleReconnectReset();

            if (callbacks.getVoiceState() === 'listening') {
              replayBufferedAudio('stt.buffered_audio.replayed');
            }
            return;
          } catch (error) {
            const normalizedError = normalizeError(error);
            reconnectErrors.push(normalizedError);
            const directive = getReconnectFailureDirective(
              normalizedError,
              callbacks.maxReconnectAttempts,
            );
            attemptBudget = Math.min(attemptBudget, directive.attemptBudget);

            callbacks.trace('stt.reconnect.failed', {
              attempt,
              attemptBudget,
              state: callbacks.getVoiceState(),
              pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
              message: normalizedError.message,
              kind: directive.kind,
              circuitStatus: getCircuitStatus(),
              isCircuitProbe,
            });

            if (!directive.retryable) {
              failReconnectTerminally(normalizedError);
              return;
            }

            if (attempt === 1) {
              callbacks.reportError(normalizedError);
            }

            if (attempt >= attemptBudget) {
              failReconnectExhausted(reconnectErrors);
              return;
            }

            forceReconnectTransport = directive.kind !== 'transport';
          }
        }
        resetReconnectLifecycle();
      } catch (error) {
        const normalizedError = normalizeError(error);
        callbacks.trace('stt.reconnect.unhandled_failure', {
          message: normalizedError.message,
          state: callbacks.getVoiceState(),
          reconnectAttempts: state.reconnect.attempts,
          pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
        });
        audioBufferQueue.flushDropEvent();
        callbacks.reportError(normalizedError);

        if (
          !callbacks.isDestroyed() &&
          isReconnectableState(callbacks.getVoiceState())
        ) {
          audioBufferQueue.reset();
          callbacks.setVoiceState('idle');
        }

        resetReconnectLifecycle();
      }
    })().finally(() => {
      replaceLifecycleState({
        reconnect: {
          kind: 'idle',
          attempts: state.reconnect.attempts,
          resetTimeout: state.reconnect.resetTimeout,
        },
      });
    });

    waitingReconnectState.promise = reconnectPromise;

    return reconnectPromise;
  }

  async function connect(operation: 'start_listening' | 'warmup' = 'warmup') {
    await connectForegroundSTT(operation);
  }

  async function startListening(): Promise<void> {
    if (callbacks.isDestroyed()) {
      throw new Error('Cannot start listening after destroy()');
    }
    if (callbacks.getVoiceState() === 'listening') {
      return;
    }
    if (state.foreground.kind === 'starting') {
      return state.foreground.promise;
    }

    if (
      callbacks.getVoiceState() !== 'idle' &&
      callbacks.getVoiceState() !== 'speaking' &&
      callbacks.getVoiceState() !== 'processing'
    ) {
      throw new Error(
        `Cannot start listening in state: ${callbacks.getVoiceState()}`,
      );
    }

    const startListeningPromise = (async () => {
      callbacks.trace('stt.start_listening.requested', {
        state: callbacks.getVoiceState(),
        pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
        isInitializing: isForegroundStarting(),
      });

      callbacks.clearAutoRestartTimeout();

      if (callbacks.getVoiceState() === 'processing') {
        callbacks.abortActiveProcessing();
      }

      callbacks.setSuppressIncomingAudio(false);
      await connect('start_listening');

      if (callbacks.isDestroyed()) {
        return;
      }

      callbacks.resetTurnTracking();
      callbacks.setVoiceState('listening');
      replayBufferedAudio('stt.buffered_audio.sent');
    })();

    replaceLifecycleState({
      foreground: {
        kind: 'starting',
        promise: startListeningPromise,
      },
    });

    try {
      await startListeningPromise;
    } finally {
      replaceLifecycleState({ foreground: { kind: 'idle' } });
    }
  }

  async function stopListening(): Promise<void> {
    if (callbacks.isDestroyed()) {
      return;
    }
    if (callbacks.getVoiceState() !== 'listening') {
      return;
    }

    const turnState = callbacks.getTurnState();

    callbacks.trace('stt.stop_listening.requested', {
      accumulatedTranscriptLength: turnState.accumulatedTranscript.length,
      currentTranscriptLength: turnState.currentTranscript.length,
      hasEmittedFinal: turnState.hasEmittedFinal,
      hasReceivedSpeech: turnState.hasReceivedSpeech,
      pendingBufferedAudioMs: audioBufferQueue.getBufferedDurationMs(),
    });

    callbacks.setPendingFinalFromVAD(true);
    callbacks.setSuppressIncomingAudio(true);

    if (!stt.isConnected()) {
      audioBufferQueue.flushDropEvent();
      audioBufferQueue.clear();
      callbacks.clearPendingFinalization();
      callbacks.setVoiceState('idle');
      return;
    }

    stt.endStream();
    audioBufferQueue.flushDropEvent();
    audioBufferQueue.clear();

    const nextTurnState = callbacks.getTurnState();
    const transcriptToFinalize =
      nextTurnState.currentTranscript || nextTurnState.accumulatedTranscript;
    const hasAnyTranscript = Boolean(transcriptToFinalize);

    if (
      !hasAnyTranscript &&
      (!nextTurnState.hasSentAudioForTurn || !stt.isConnected()) &&
      !nextTurnState.hasReceivedSpeech
    ) {
      callbacks.clearPendingFinalization();
      callbacks.setVoiceState('idle');
      return;
    }

    if (transcriptToFinalize) {
      callbacks.clearPendingFinalization();

      const { emitted, startedProcessing } =
        callbacks.finalizeTranscript(transcriptToFinalize);

      if (emitted) {
        callbacks.trace('stt.manual_final_transcript.forwarded', {
          textLength: transcriptToFinalize.length,
          preview: transcriptToFinalize.slice(0, 80),
        });
      }

      if (!startedProcessing && callbacks.getVoiceState() === 'listening') {
        callbacks.setVoiceState('idle');
      }

      return;
    }

    callbacks.startTranscriptGrace();
  }

  function endStream(): void {
    stt.endStream();
  }

  function sendAudio(chunk: AudioChunk, _durationMs?: number): void {
    if (callbacks.isDestroyed()) {
      return;
    }
    if (callbacks.getTurnState().suppressIncomingAudio) {
      callbacks.trace('stt.audio.ignored_after_manual_stop', {
        bytes: chunk.data.length,
        sampleRate: chunk.sampleRate,
        encoding: chunk.encoding,
        state: callbacks.getVoiceState(),
      });
      return;
    }

    callbacks.markHasSentAudioForTurn();

    if (isForegroundStarting() || callbacks.getVoiceState() === 'idle') {
      audioBufferQueue.push(
        chunk,
        'pre_connection_buffer_full',
        'stt.audio.buffered',
        {
          bytes: chunk.data.length,
          sampleRate: chunk.sampleRate,
          encoding: chunk.encoding,
          state: callbacks.getVoiceState(),
          isInitializing: isForegroundStarting(),
        },
      );
      return;
    }

    if (callbacks.getVoiceState() !== 'listening') {
      audioBufferQueue.dropNonListeningChunk({
        voiceState: callbacks.getVoiceState(),
        chunk,
        normalizeError,
      });
      return;
    }

    if (stt.isConnected()) {
      try {
        callbacks.trace('stt.audio.sent', {
          bytes: chunk.data.length,
          sampleRate: chunk.sampleRate,
          encoding: chunk.encoding,
        });
        stt.sendAudio(chunk);
      } catch (error) {
        const normalizedError = normalizeError(error);
        callbacks.trace('stt.audio.send_failed', {
          bytes: chunk.data.length,
          sampleRate: chunk.sampleRate,
          encoding: chunk.encoding,
          message: normalizedError.message,
        });
        callbacks.reportError(
          new Error('Failed to send STT audio chunk while listening', {
            cause: normalizedError,
          }),
        );

        audioBufferQueue.push(
          chunk,
          'stt_send_failed',
          'stt.audio.buffered.after_send_failure',
          {
            bytes: chunk.data.length,
            sampleRate: chunk.sampleRate,
            encoding: chunk.encoding,
            state: callbacks.getVoiceState(),
          },
        );
      }
      return;
    }

    audioBufferQueue.push(
      chunk,
      'reconnect_buffer_full',
      'stt.audio.buffered.waiting_for_connection',
      {
        bytes: chunk.data.length,
        sampleRate: chunk.sampleRate,
        encoding: chunk.encoding,
      },
    );
  }

  async function forceReconnect() {
    if (callbacks.isDestroyed()) {
      return;
    }

    if (isReconnectableState(callbacks.getVoiceState())) {
      await reconnectSTT({
        type: 'disconnected',
        clean: false,
        message: 'Forced STT reconnect',
      });
      return;
    }

    await connectTransport(true);
  }

  async function disconnect() {
    state.sttUnsubscribe?.();
    state.sttUnsubscribe = null;
    clearReconnectDelayTimeout();
    clearReconnectResetTimeout();
    clearSttCircuitCooldownTimeout();
    await stt.disconnect();
  }

  return {
    connect,
    disconnect,
    endStream,
    forceReconnect,
    getCircuitStatus() {
      return getCircuitStatus();
    },
    sendAudio,
    startListening,
    stopListening,
  };
}
