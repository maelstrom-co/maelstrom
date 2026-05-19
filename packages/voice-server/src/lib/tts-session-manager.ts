import { createTTSError } from './provider-errors.js';
import { createInitialTTSSessionManagerState } from './tts-session-manager.state.js';
import type {
  SpeechChunk,
  TTSEvent,
  TTSProvider,
  VoiceDisconnectedEvent,
  VoiceSessionCallbacks,
  VoiceSessionQueuedTurnsDroppedError,
  VoiceSessionState,
} from './types.js';

type NotifyCallbackSafely = <T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  traceEvent: string,
  ...args: T
) => void;

type TTSSessionManagerCallbacks = {
  isDestroyed: () => boolean;
  getVoiceState: () => VoiceSessionState;
  setVoiceState: (state: VoiceSessionState) => void;
  trace: (event: string, details?: Record<string, unknown>) => void;
  reportError: (error: unknown) => void;
  reportAsyncFailure: (
    event: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
  notifyCallbackSafely: NotifyCallbackSafely;
  emitAudioOutput: (chunk: SpeechChunk) => number;
  onSpeechStarted: VoiceSessionCallbacks['onSpeechStarted'];
  onSpeechStopped: VoiceSessionCallbacks['onSpeechStopped'];
};

type DispatchSpeakOptions = {
  clearQueue?: boolean;
  queued?: boolean;
  stopActiveSpeech?: boolean;
};

type StopContext = 'dispatch_speak' | 'interrupt' | 'process_request';

function getDroppedQueueCount(error: unknown): number {
  return error instanceof Error &&
    typeof (error as { droppedQueueCount?: unknown }).droppedQueueCount ===
      'number'
    ? (error as unknown as { droppedQueueCount: number }).droppedQueueCount
    : 0;
}

function createQueuedTurnsDroppedError(
  droppedQueueCount: number,
): VoiceSessionQueuedTurnsDroppedError {
  return Object.assign(
    new Error(
      'Queued speech turns were dropped after a queued dispatch failure',
    ),
    { droppedQueueCount },
  );
}

function isDisconnectedEvent(event: TTSEvent): event is VoiceDisconnectedEvent {
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

export function createTTSSessionManager(
  tts: TTSProvider,
  callbacks: TTSSessionManagerCallbacks,
) {
  const state = createInitialTTSSessionManagerState();

  function clearQueue() {
    state.speakQueue = [];
  }

  function invalidatePendingDispatches() {
    state.pendingDispatchGeneration += 1;
    state.pendingDispatchCount = 0;
  }

  async function dispatchSpeak(
    text: string,
    voice?: string,
    options: DispatchSpeakOptions = {},
  ): Promise<void> {
    const {
      clearQueue: shouldClearQueue = false,
      queued = false,
      stopActiveSpeech = false,
    } = options;

    if (text.trim().length === 0) {
      return;
    }

    if (shouldClearQueue) {
      clearQueue();
    }

    const dispatchGeneration = state.pendingDispatchGeneration + 1;
    state.pendingDispatchGeneration = dispatchGeneration;

    if (stopActiveSpeech && !state.activeSpeech.finished) {
      stop('idle', {
        clearQueue: false,
        context: 'dispatch_speak',
        invalidatePending: false,
      });
    }

    callbacks.setVoiceState('speaking');
    state.pendingDispatchCount += 1;

    try {
      await speak(text, {
        voice,
        replaceActiveSpeech: false,
        shouldDispatch: () =>
          !callbacks.isDestroyed() &&
          dispatchGeneration === state.pendingDispatchGeneration,
      });
    } catch (error) {
      if (queued) {
        const droppedQueueCount = state.speakQueue.length;

        if (droppedQueueCount > 0) {
          callbacks.trace('tts.queued_turns.dropped', {
            droppedQueueCount,
          });
          clearQueue();
          callbacks.setVoiceState('idle');
          throw createQueuedTurnsDroppedError(droppedQueueCount);
        }
      }

      if (state.activeSpeech.finished) {
        callbacks.setVoiceState('idle');
      }

      throw error;
    } finally {
      state.pendingDispatchCount = Math.max(0, state.pendingDispatchCount - 1);
    }
  }

  function advanceQueueAfterSpeechStop(completed: boolean) {
    const nextQueuedSpeech = state.speakQueue.shift();

    if (!nextQueuedSpeech) {
      return;
    }

    if (!completed) {
      callbacks.trace('tts.queue.advanced_after_unclean_stop', {
        generation: state.activeSpeech.generation,
        nextTextLength: nextQueuedSpeech.text.length,
        nextPreview: nextQueuedSpeech.text.slice(0, 80),
        remainingQueuedTurns: state.speakQueue.length,
      });
    }

    void dispatchSpeak(nextQueuedSpeech.text, nextQueuedSpeech.voice, {
      queued: true,
    }).catch((error) => {
      callbacks.reportAsyncFailure('tts.queued_speak.failed', error, {
        textLength: nextQueuedSpeech.text.length,
        preview: nextQueuedSpeech.text.slice(0, 80),
        requestedVoice: nextQueuedSpeech.voice ?? null,
        generation: state.activeSpeech.generation,
        droppedQueueCount: getDroppedQueueCount(error),
      });

      if (callbacks.getVoiceState() !== 'processing') {
        callbacks.setVoiceState('idle');
      }
    });
  }

  function completeActiveSpeech(
    generation: number,
    completed: boolean,
    nextState: VoiceSessionState = 'idle',
  ) {
    if (
      callbacks.isDestroyed() ||
      state.activeSpeech.generation !== generation ||
      state.activeSpeech.finished
    ) {
      return;
    }

    state.activeSpeech.finished = true;
    callbacks.setVoiceState(nextState);
    advanceQueueAfterSpeechStop(completed);
    callbacks.notifyCallbackSafely(
      callbacks.onSpeechStopped,
      'callback.onSpeechStopped.failed',
      completed,
    );
  }

  function handleInterruptedSpeech(nextState: VoiceSessionState = 'idle') {
    completeActiveSpeech(state.activeSpeech.generation, false, nextState);
  }

  function handleTTSEvent(event: TTSEvent) {
    switch (event.type) {
      case 'chunk':
        callbacks.trace('tts.chunk.received', {
          bytes: event.chunk.data.length,
          format: event.chunk.format,
          sampleRate: event.chunk.sampleRate,
          sequence: event.chunk.sequence,
          isFinal: event.chunk.isFinal,
          listenerCount: callbacks.emitAudioOutput(event.chunk),
        });
        callbacks.trace('tts.chunk.forwarded', {
          bytes: event.chunk.data.length,
          sequence: event.chunk.sequence,
          isFinal: event.chunk.isFinal,
        });
        break;
      case 'error':
        callbacks.trace('tts.error', {
          kind: event.error.kind,
          message: event.error.message,
          provider: event.error.provider,
        });
        callbacks.reportError(event.error);
        handleInterruptedSpeech();
        break;
      case 'disconnected':
        if (!isDisconnectedEvent(event)) {
          break;
        }

        callbacks.trace('tts.disconnected', {
          provider: tts.name,
          clean: event.clean,
          message: event.message,
        });
        if (callbacks.getVoiceState() === 'speaking') {
          if (!event.clean) {
            callbacks.reportError(
              createTTSError(tts.name, 'transport', event.message, event),
            );
          }
          handleInterruptedSpeech();
        }
        break;
    }
  }

  async function connect() {
    if (!tts.isConnected()) {
      callbacks.trace('tts.connecting', {
        provider: tts.name,
      });
      await tts.connect();
    }

    if (!state.ttsUnsubscribe) {
      state.ttsUnsubscribe = tts.onEvent(handleTTSEvent);
    }
  }

  async function disconnect() {
    state.ttsUnsubscribe?.();
    state.ttsUnsubscribe = null;
    await tts.disconnect();
  }

  function stop(
    nextState: VoiceSessionState = 'idle',
    options: {
      clearQueue?: boolean;
      context?: StopContext;
      invalidatePending?: boolean;
    } = {},
  ) {
    if (callbacks.isDestroyed() || callbacks.getVoiceState() !== 'speaking') {
      return;
    }

    const {
      clearQueue: shouldClearQueue = true,
      context = 'interrupt',
      invalidatePending = true,
    } = options;
    const hadPendingDispatch = state.pendingDispatchCount > 0;

    if (shouldClearQueue) {
      clearQueue();
    }

    if (invalidatePending) {
      invalidatePendingDispatches();
    }

    try {
      tts.stop();
    } catch (error) {
      callbacks.reportAsyncFailure('tts.stop.failed', error, {
        context,
        provider: tts.name,
        providerConnected: tts.isConnected(),
        state: callbacks.getVoiceState(),
      });
    }

    handleInterruptedSpeech(nextState);

    if (hadPendingDispatch && state.activeSpeech.finished) {
      callbacks.setVoiceState(nextState);
    }
  }

  async function speak(
    text: string,
    config: {
      voice?: string;
      shouldDispatch?: () => boolean;
      replaceActiveSpeech?: boolean;
    } = {},
  ) {
    callbacks.trace('tts.speak.requested', {
      textLength: text.length,
      preview: text.slice(0, 80),
      requestedVoice: config.voice ?? null,
      provider: tts.name,
      providerConnected: tts.isConnected(),
      state: callbacks.getVoiceState(),
    });

    if (
      config.replaceActiveSpeech !== false &&
      callbacks.getVoiceState() === 'speaking'
    ) {
      tts.stop();
    }

    await connect();

    if (callbacks.isDestroyed() || config.shouldDispatch?.() === false) {
      return;
    }

    const speakOptions: { voice?: string } = {};
    if (config.voice) {
      speakOptions.voice = config.voice;
    }

    const generation = state.activeSpeechGeneration + 1;
    const handle = tts.speak(text, speakOptions);

    state.activeSpeechGeneration = generation;
    state.activeSpeech = {
      generation,
      finished: false,
    };
    callbacks.setVoiceState('speaking');
    callbacks.trace('tts.speak.dispatched', {
      provider: tts.name,
      requestedVoice: speakOptions.voice ?? null,
      generation,
    });
    callbacks.notifyCallbackSafely(
      callbacks.onSpeechStarted,
      'callback.onSpeechStarted.failed',
      handle.speech,
    );

    void handle.completion
      .then((reason) => {
        if (reason === 'completed') {
          completeActiveSpeech(generation, true);
          return;
        }

        completeActiveSpeech(generation, false);
      })
      .catch((error) => {
        callbacks.reportAsyncFailure('tts.completion.failed', error, {
          provider: tts.name,
          generation,
        });
        completeActiveSpeech(generation, false);
      });
  }

  function enqueueSpeak(text: string, voice?: string): void {
    if (callbacks.isDestroyed() || text.trim().length === 0) {
      return;
    }

    if (
      callbacks.getVoiceState() === 'speaking' ||
      state.pendingDispatchCount > 0
    ) {
      state.speakQueue.push({ text, voice });
      return;
    }

    void dispatchSpeak(text, voice).catch((error) => {
      callbacks.reportAsyncFailure('tts.enqueue_speak.failed', error, {
        textLength: text.length,
        preview: text.slice(0, 80),
        requestedVoice: voice ?? null,
      });
    });
  }

  async function speakNow(text: string, voice?: string): Promise<void> {
    if (text.trim().length === 0) {
      return;
    }

    await dispatchSpeak(text, voice, {
      clearQueue: true,
      stopActiveSpeech: true,
    });
  }

  function destroy() {
    clearQueue();
    invalidatePendingDispatches();
    state.ttsUnsubscribe?.();
    state.ttsUnsubscribe = null;
  }

  return {
    connect,
    destroy,
    disconnect,
    enqueueSpeak,
    speak,
    speakNow,
    stop,
    hasActiveSpeech() {
      return !state.activeSpeech.finished;
    },
    getActiveSpeechGeneration() {
      return state.activeSpeech.generation;
    },
  };
}
