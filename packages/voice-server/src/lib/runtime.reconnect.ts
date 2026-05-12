import type { VoiceRuntimeState } from './runtime.state.js';
import type {
  STTError,
  VoiceProviderErrorKind,
  VoiceSessionState,
} from './types.js';

const reconnectStabilityWindowMs = 5000;
const serverRetryAttemptBudget = 1;

export type STTReconnectTrigger =
  | { type: 'disconnected'; clean: false; message: string }
  | { type: 'error'; error: STTError };

type ReconnectFailureDirective = {
  retryable: boolean;
  attemptBudget: number;
  kind: VoiceProviderErrorKind | 'generic';
};

interface ReconnectSTTOptions {
  state: VoiceRuntimeState;
  trigger: STTReconnectTrigger;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  reconnectBackoffMultiplier: number;
  reconnectJitterMs: number;
  trace: (event: string, details?: Record<string, unknown>) => void;
  reportError: (error: unknown) => void;
  connectSTT: (forceReconnect: boolean) => Promise<void>;
  flushBufferedAudio: (traceEvent: string) => void;
  flushPendingAudioDropEvent: () => void;
  resetBufferedAudioState: () => void;
  setVoiceState: (state: VoiceSessionState) => void;
  openSttCircuit: () => void;
  closeSttCircuit: () => void;
}

function normalizeReconnectError(error: unknown): Error {
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

function getInitialAttemptBudget(
  trigger: STTReconnectTrigger,
  state: VoiceRuntimeState,
  maxReconnectAttempts: number,
): number {
  if (state.sttCircuitStatus === 'half_open') {
    return 1;
  }

  if (trigger.type === 'disconnected') {
    return maxReconnectAttempts;
  }

  return getReconnectFailureDirective(trigger.error, maxReconnectAttempts)
    .attemptBudget;
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

function clearReconnectResetTimeout(state: VoiceRuntimeState) {
  if (state.reconnectResetTimeout) {
    clearTimeout(state.reconnectResetTimeout);
    state.reconnectResetTimeout = null;
  }
}

function scheduleReconnectReset(state: VoiceRuntimeState) {
  clearReconnectResetTimeout(state);
  // WHY: We only reset the attempt counter after a short stable period. Immediate reset would let a
  // flapping provider loop forever while still appearing to respect the retry budget.
  state.reconnectResetTimeout = setTimeout(() => {
    state.reconnectAttempts = 0;
    state.reconnectResetTimeout = null;
  }, reconnectStabilityWindowMs);
}

function resetReconnectLifecycle(state: VoiceRuntimeState) {
  clearReconnectResetTimeout(state);
  state.reconnectAttempts = 0;
}

function failReconnectExhausted(
  state: VoiceRuntimeState,
  reconnectErrors: Error[],
  trace: (event: string, details?: Record<string, unknown>) => void,
  reportError: (error: unknown) => void,
  flushPendingAudioDropEvent: () => void,
  resetBufferedAudioState: () => void,
  setVoiceState: (state: VoiceSessionState) => void,
  openSttCircuit: () => void,
) {
  trace('stt.reconnect.exhausted', {
    attempts: state.reconnectAttempts,
    state: state.state,
    pendingBufferedAudioMs: state.pendingAudioDurationMs,
    circuitStatus: state.sttCircuitStatus,
  });
  openSttCircuit();
  flushPendingAudioDropEvent();
  reportError(createReconnectExhaustedError(reconnectErrors));
  resetBufferedAudioState();
  setVoiceState('idle');
  resetReconnectLifecycle(state);
}

function failReconnectTerminally(
  state: VoiceRuntimeState,
  error: Error,
  reportError: (error: unknown) => void,
  flushPendingAudioDropEvent: () => void,
  resetBufferedAudioState: () => void,
  setVoiceState: (state: VoiceSessionState) => void,
) {
  // WHY: Flush reconnect-era audio-drop telemetry before we clear the buffered state. Once reset
  // runs, that pending loss accounting is gone and the terminal provider error would hide it.
  flushPendingAudioDropEvent();
  reportError(error);
  resetBufferedAudioState();
  setVoiceState('idle');
  resetReconnectLifecycle(state);
}

export async function reconnectSTT(
  options: ReconnectSTTOptions,
): Promise<void> {
  const {
    state,
    trigger,
    maxReconnectAttempts,
    reconnectDelayMs,
    maxReconnectDelayMs,
    reconnectBackoffMultiplier,
    reconnectJitterMs,
    trace,
    reportError,
    connectSTT,
    flushBufferedAudio,
    flushPendingAudioDropEvent,
    resetBufferedAudioState,
    setVoiceState,
    openSttCircuit,
    closeSttCircuit,
  } = options;

  if (state.reconnectPromise) {
    // WHY: Reconnect must be single-flight. Parallel retry loops would race to replace provider
    // subscriptions and would replay buffered audio more than once.
    return state.reconnectPromise;
  }

  if (state.sttCircuitStatus === 'open') {
    trace('stt.reconnect.skipped', {
      reason: 'circuit_open',
      triggerType: trigger.type,
      state: state.state,
      pendingBufferedAudioMs: state.pendingAudioDurationMs,
    });
    return Promise.resolve();
  }

  state.reconnectPromise = (async () => {
    clearReconnectResetTimeout(state);
    state.reconnectAttempts = 0;
    const reconnectErrors: Error[] = [];
    const isCircuitProbe = state.sttCircuitStatus === 'half_open';
    let attemptBudget = getInitialAttemptBudget(
      trigger,
      state,
      maxReconnectAttempts,
    );
    let forceReconnectTransport = shouldForceReconnectTransport(trigger);
    let reconnectAttemptsThisCycle = 0;

    try {
      if (attemptBudget <= 0) {
        trace('stt.reconnect.skipped', {
          reason: 'not_retryable',
          triggerType: trigger.type,
          state: state.state,
          circuitStatus: state.sttCircuitStatus,
        });
        resetReconnectLifecycle(state);
        return;
      }

      while (!state.destroyed && isReconnectableState(state.state)) {
        const attempt = reconnectAttemptsThisCycle + 1;
        const delayMs = calculateReconnectDelayMs(
          attempt,
          reconnectDelayMs,
          reconnectBackoffMultiplier,
          maxReconnectDelayMs,
          reconnectJitterMs,
        );

        trace('stt.reconnect.attempt', {
          attempt,
          attemptBudget,
          state: state.state,
          delayMs,
          circuitStatus: state.sttCircuitStatus,
          isCircuitProbe,
          pendingBufferedAudioMs: state.pendingAudioDurationMs,
        });

        reconnectAttemptsThisCycle = attempt;
        state.reconnectAttempts = attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        if (state.destroyed || !isReconnectableState(state.state)) {
          resetReconnectLifecycle(state);
          return;
        }

        try {
          await connectSTT(forceReconnectTransport);
          trace('stt.reconnect.succeeded', {
            pendingBufferedAudioMs: state.pendingAudioDurationMs,
            state: state.state,
            attempt,
            attemptBudget,
            circuitStatus: state.sttCircuitStatus,
            isCircuitProbe,
          });

          if (isCircuitProbe) {
            closeSttCircuit();
          }

          scheduleReconnectReset(state);

          if (state.state === 'listening') {
            // WHY: Buffered audio is only safe to replay while the runtime is actively listening.
            // Replaying during processing would inject stale user audio into the next turn.
            flushBufferedAudio('stt.buffered_audio.replayed');
          }
          return;
        } catch (error) {
          const normalizedError = normalizeReconnectError(error);
          reconnectErrors.push(normalizedError);
          const directive = getReconnectFailureDirective(
            normalizedError,
            maxReconnectAttempts,
          );
          attemptBudget = Math.min(attemptBudget, directive.attemptBudget);

          trace('stt.reconnect.failed', {
            attempt,
            attemptBudget,
            state: state.state,
            pendingBufferedAudioMs: state.pendingAudioDurationMs,
            message: normalizedError.message,
            kind: directive.kind,
            circuitStatus: state.sttCircuitStatus,
            isCircuitProbe,
          });

          if (!directive.retryable) {
            failReconnectTerminally(
              state,
              normalizedError,
              reportError,
              flushPendingAudioDropEvent,
              resetBufferedAudioState,
              setVoiceState,
            );
            return;
          }

          if (attempt === 1) {
            reportError(normalizedError);
          }

          if (attempt >= attemptBudget) {
            failReconnectExhausted(
              state,
              reconnectErrors,
              trace,
              reportError,
              flushPendingAudioDropEvent,
              resetBufferedAudioState,
              setVoiceState,
              openSttCircuit,
            );
            return;
          }

          forceReconnectTransport = directive.kind !== 'transport';
        }
      }
      resetReconnectLifecycle(state);
    } catch (error) {
      const normalizedError = normalizeReconnectError(error);
      trace('stt.reconnect.unhandled_failure', {
        message: normalizedError.message,
        state: state.state,
        reconnectAttempts: state.reconnectAttempts,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
      });
      flushPendingAudioDropEvent();
      reportError(normalizedError);

      if (!state.destroyed && isReconnectableState(state.state)) {
        resetBufferedAudioState();
        setVoiceState('idle');
      }

      resetReconnectLifecycle(state);
    }
  })().finally(() => {
    state.reconnectPromise = null;
  });

  return state.reconnectPromise;
}
