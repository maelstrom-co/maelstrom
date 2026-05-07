import type { VoiceRuntimeState } from './runtime.state.js';
import type { VoiceSessionState } from './types.js';

const reconnectStabilityWindowMs = 5000;

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

function isTerminalReconnectError(
  error: Error,
): error is Error & { kind: 'auth' | 'quota' } {
  const kind = (error as { kind?: unknown }).kind;

  // WHY: Only explicit auth/quota failures are terminal in the current provider error taxonomy.
  // Transport/server/unknown failures can be transient, and parse stays retryable because a broken
  // stream can surface truncated provider payloads that disappear after reconnect.
  return kind === 'auth' || kind === 'quota';
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
  state: VoiceRuntimeState,
  maxReconnectAttempts: number,
  reconnectDelayMs: number,
  trace: (event: string, details?: Record<string, unknown>) => void,
  reportError: (error: unknown) => void,
  ensureSTTConnected: () => Promise<void>,
  flushBufferedAudio: (traceEvent: string) => void,
  flushPendingAudioDropEvent: () => void,
  resetBufferedAudioState: () => void,
  setVoiceState: (state: VoiceSessionState) => void,
): Promise<void> {
  if (state.reconnectPromise) {
    // WHY: Reconnect must be single-flight. Parallel retry loops would race to replace provider
    // subscriptions and would replay buffered audio more than once.
    return state.reconnectPromise;
  }

  state.reconnectPromise = (async () => {
    clearReconnectResetTimeout(state);
    let lastError: Error | undefined;
    const reconnectErrors: Error[] = [];

    try {
      while (!state.destroyed && isReconnectableState(state.state)) {
        if (state.reconnectAttempts >= maxReconnectAttempts) {
          trace('stt.reconnect.exhausted', {
            attempts: state.reconnectAttempts,
            maxReconnectAttempts,
            state: state.state,
            pendingBufferedAudioMs: state.pendingAudioDurationMs,
            lastErrorMessage: lastError?.message ?? null,
          });
          flushPendingAudioDropEvent();
          reportError(createReconnectExhaustedError(reconnectErrors));
          resetBufferedAudioState();
          setVoiceState('idle');
          resetReconnectLifecycle(state);
          return;
        }

        const attempt = state.reconnectAttempts + 1;
        trace('stt.reconnect.attempt', {
          attempt,
          maxReconnectAttempts,
          state: state.state,
          pendingBufferedAudioMs: state.pendingAudioDurationMs,
        });

        state.reconnectAttempts = attempt;
        await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));

        if (state.destroyed || !isReconnectableState(state.state)) {
          resetReconnectLifecycle(state);
          return;
        }

        try {
          await ensureSTTConnected();
          trace('stt.reconnect.succeeded', {
            pendingBufferedAudioMs: state.pendingAudioDurationMs,
            state: state.state,
          });
          scheduleReconnectReset(state);

          if (state.state === 'listening') {
            // WHY: Buffered audio is only safe to replay while the runtime is actively listening.
            // Replaying during processing would inject stale user audio into the next turn.
            flushBufferedAudio('stt.buffered_audio.replayed');
          }
          return;
        } catch (error) {
          const normalizedError = normalizeReconnectError(error);
          lastError = normalizedError;
          reconnectErrors.push(normalizedError);
          trace('stt.reconnect.failed', {
            attempt,
            maxReconnectAttempts,
            state: state.state,
            pendingBufferedAudioMs: state.pendingAudioDurationMs,
            message: normalizedError.message,
          });

          if (isTerminalReconnectError(normalizedError)) {
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
