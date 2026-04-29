import type { VoiceRuntimeState } from './runtime.state.js';
import type { VoiceSessionState } from './types.js';

const reconnectStabilityWindowMs = 5000;

function normalizeReconnectError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error), { cause: error });
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

export async function reconnectSTT(
  state: VoiceRuntimeState,
  maxReconnectAttempts: number,
  reconnectDelayMs: number,
  trace: (event: string, details?: Record<string, unknown>) => void,
  reportError: (error: unknown) => void,
  ensureSTTConnected: () => Promise<void>,
  flushBufferedAudio: (traceEvent: string) => void,
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

    try {
      while (!state.destroyed && isReconnectableState(state.state)) {
        if (state.reconnectAttempts >= maxReconnectAttempts) {
          trace('stt.reconnect.exhausted', {
            attempts: state.reconnectAttempts,
            maxReconnectAttempts,
            state: state.state,
            pendingBufferedAudioChunks: state.pendingAudioChunks.length,
            lastErrorMessage: lastError?.message ?? null,
          });
          reportError(
            new Error('STT connection lost after max retries', {
              cause: lastError,
            }),
          );
          setVoiceState('idle');
          resetReconnectLifecycle(state);
          return;
        }

        const attempt = state.reconnectAttempts + 1;
        trace('stt.reconnect.attempt', {
          attempt,
          maxReconnectAttempts,
          state: state.state,
          pendingBufferedAudioChunks: state.pendingAudioChunks.length,
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
            pendingBufferedAudioChunks: state.pendingAudioChunks.length,
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
          trace('stt.reconnect.failed', {
            attempt,
            maxReconnectAttempts,
            state: state.state,
            pendingBufferedAudioChunks: state.pendingAudioChunks.length,
            message: normalizedError.message,
          });
        }
      }
      resetReconnectLifecycle(state);
    } catch (error) {
      const normalizedError = normalizeReconnectError(error);
      trace('stt.reconnect.unhandled_failure', {
        message: normalizedError.message,
        state: state.state,
        reconnectAttempts: state.reconnectAttempts,
        pendingBufferedAudioChunks: state.pendingAudioChunks.length,
      });
      reportError(normalizedError);

      if (!state.destroyed && isReconnectableState(state.state)) {
        setVoiceState('idle');
      }

      resetReconnectLifecycle(state);
    }
  })().finally(() => {
    state.reconnectPromise = null;
  });

  return state.reconnectPromise;
}
