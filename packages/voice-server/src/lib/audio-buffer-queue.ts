import { createInitialAudioBufferQueueState } from './audio-buffer-queue.state.js';
import type {
  AudioChunk,
  AudioEncoding,
  STTProvider,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionAudioDropReason,
  VoiceSessionState,
} from './types.js';

export interface BufferedAudioChunk {
  chunk: AudioChunk;
  durationMs: number;
  bufferingReason: VoiceSessionAudioDropReason;
}

export const defaultAudioDropDebounceMs = 100;

export interface CreateAudioBufferQueueOptions {
  audioBufferMaxMs: number;
  trace: (event: string, details?: Record<string, unknown>) => void;
  reportError: (error: unknown) => void;
  emitAudioDropped: (event: VoiceSessionAudioDroppedEvent) => void;
  isDestroyed: () => boolean;
}

export interface ReplayBufferedAudioOptions {
  stt: STTProvider;
  traceEvent: string;
  getVoiceState: () => VoiceSessionState;
  markHasSentAudioForTurn: () => void;
}

export interface DropNonListeningAudioChunkOptions {
  voiceState: VoiceSessionState;
  chunk: AudioChunk;
  normalizeError: (error: unknown) => Error;
}

function defaultBytesPerSample(encoding: AudioEncoding): number {
  switch (encoding) {
    case 'linear16':
      return 2;
    case 'pcm':
      return 4;
    case 'opus':
      throw new Error(
        'Opus audio chunks must provide bytesPerSample before buffering so duration can be estimated safely',
      );
  }

  const exhaustiveEncoding: never = encoding;

  throw new Error(`Unsupported audio encoding: ${String(exhaustiveEncoding)}`);
}

export function measureAudioChunkDurationMs(chunk: AudioChunk): number {
  const bytesPerSample =
    chunk.bytesPerSample ?? defaultBytesPerSample(chunk.encoding);
  const channels = chunk.channels ?? 1;
  const bytesPerSecond = chunk.sampleRate * bytesPerSample * channels;

  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return Number.NaN;
  }

  return (chunk.data.byteLength / bytesPerSecond) * 1000;
}

export function createAudioBufferQueue({
  audioBufferMaxMs,
  trace,
  reportError,
  emitAudioDropped,
  isDestroyed,
}: CreateAudioBufferQueueOptions) {
  const state = createInitialAudioBufferQueueState();

  function clearDropDebounceTimeout() {
    if (state.pendingAudioDropDebounceTimeout) {
      clearTimeout(state.pendingAudioDropDebounceTimeout);
      state.pendingAudioDropDebounceTimeout = null;
    }
  }

  function emitDroppedEventIfActive(event: VoiceSessionAudioDroppedEvent) {
    if (isDestroyed()) {
      return;
    }

    emitAudioDropped(event);
  }

  function addDroppedDuration(
    reason: VoiceSessionAudioDropReason,
    droppedDurationMs: number,
  ): VoiceSessionAudioDroppedEvent | null {
    if (droppedDurationMs <= 0) {
      return null;
    }

    const previousEvent = state.pendingAudioDropEvent;

    if (previousEvent && previousEvent.reason !== reason) {
      clearDropDebounceTimeout();
      state.pendingAudioDropEvent = {
        type: 'audio_dropped',
        reason,
        droppedDurationMs,
      };
      return previousEvent;
    }

    state.pendingAudioDropEvent = previousEvent
      ? {
          ...previousEvent,
          droppedDurationMs:
            previousEvent.droppedDurationMs + droppedDurationMs,
        }
      : {
          type: 'audio_dropped',
          reason,
          droppedDurationMs,
        };

    return null;
  }

  function scheduleDropDebounce() {
    if (!state.pendingAudioDropEvent || state.pendingAudioDropDebounceTimeout) {
      return;
    }

    state.pendingAudioDropDebounceTimeout = setTimeout(() => {
      state.pendingAudioDropDebounceTimeout = null;

      if (isDestroyed() || !state.pendingAudioDropEvent) {
        return;
      }

      const event = state.pendingAudioDropEvent;
      state.pendingAudioDropEvent = null;
      emitAudioDropped(event);
    }, defaultAudioDropDebounceMs);
  }

  function discardDropEvent() {
    clearDropDebounceTimeout();
    state.pendingAudioDropEvent = null;
  }

  function flushDropEvent() {
    clearDropDebounceTimeout();

    if (isDestroyed() || !state.pendingAudioDropEvent) {
      state.pendingAudioDropEvent = null;
      return;
    }

    const event = state.pendingAudioDropEvent;
    state.pendingAudioDropEvent = null;
    emitAudioDropped(event);
  }

  function shiftBufferedAudio(): BufferedAudioChunk | undefined {
    const nextEntry = state.pendingAudioChunks.shift();

    if (!nextEntry) {
      return undefined;
    }

    state.pendingAudioDurationMs = Math.max(
      0,
      state.pendingAudioDurationMs - nextEntry.durationMs,
    );

    if (state.pendingAudioChunks.length === 0) {
      state.pendingAudioDurationMs = 0;
    }

    return nextEntry;
  }

  function clear() {
    state.pendingAudioChunks.length = 0;
    state.pendingAudioDurationMs = 0;
  }

  function reset() {
    clear();
    discardDropEvent();
  }

  function push(
    chunk: AudioChunk,
    dropReason: VoiceSessionAudioDropReason,
    traceEvent: string,
    traceDetails: Record<string, unknown>,
  ): boolean {
    let durationMs: number;

    try {
      durationMs = measureAudioChunkDurationMs(chunk);
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      reportError(normalizedError);
      trace('stt.audio.buffer_rejected', {
        ...traceDetails,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
        chunkDurationMs: null,
        audioBufferMaxMs,
        reason: 'invalid_duration',
        bytesPerSample: chunk.bytesPerSample ?? null,
        channels: chunk.channels ?? null,
        message: normalizedError.message,
      });
      return false;
    }

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      const error = new Error(
        `STT audio chunk duration must be positive, received ${durationMs}ms`,
      );
      reportError(error);
      trace('stt.audio.buffer_rejected', {
        ...traceDetails,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
        chunkDurationMs: durationMs,
        audioBufferMaxMs,
        reason: 'invalid_duration',
        bytesPerSample: chunk.bytesPerSample ?? null,
        channels: chunk.channels ?? null,
        message: error.message,
      });
      return false;
    }

    let droppedDurationMs = 0;

    while (state.pendingAudioDurationMs + durationMs > audioBufferMaxMs) {
      const droppedEntry = shiftBufferedAudio();

      if (!droppedEntry) {
        droppedDurationMs += durationMs;
        const replacedPendingDropEvent = addDroppedDuration(
          dropReason,
          droppedDurationMs,
        );

        if (replacedPendingDropEvent) {
          emitDroppedEventIfActive(replacedPendingDropEvent);
        }

        scheduleDropDebounce();

        trace('stt.audio.buffer_overflow', {
          ...traceDetails,
          pendingBufferedAudioMs: state.pendingAudioDurationMs,
          chunkDurationMs: durationMs,
          droppedDurationMs,
          audioBufferMaxMs,
        });
        reportError(
          new Error(
            `Dropped ${droppedDurationMs}ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs`,
          ),
        );
        return false;
      }

      droppedDurationMs += droppedEntry.durationMs;
    }

    if (droppedDurationMs > 0) {
      const replacedPendingDropEvent = addDroppedDuration(
        dropReason,
        droppedDurationMs,
      );

      if (replacedPendingDropEvent) {
        emitDroppedEventIfActive(replacedPendingDropEvent);
      }

      scheduleDropDebounce();

      reportError(
        new Error(
          `Dropped ${droppedDurationMs}ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs`,
        ),
      );
    }

    state.pendingAudioChunks.push({
      chunk,
      durationMs,
      bufferingReason: dropReason,
    });
    state.pendingAudioDurationMs += durationMs;
    trace(traceEvent, {
      ...traceDetails,
      pendingBufferedAudioMs: state.pendingAudioDurationMs,
      chunkDurationMs: durationMs,
      droppedDurationMs,
      audioBufferMaxMs,
    });
    return true;
  }

  function replay({
    stt,
    traceEvent,
    getVoiceState,
    markHasSentAudioForTurn,
  }: ReplayBufferedAudioOptions) {
    function traceFlushStopped(
      reason: 'stt_disconnected' | 'state_changed',
      entry: BufferedAudioChunk,
    ) {
      trace('stt.buffered_audio.flush_stopped', {
        reason,
        state: getVoiceState(),
        nextBufferedAudioSequence: entry.chunk.sequence ?? null,
        nextBufferedAudioTimestamp: entry.chunk.timestamp,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
      });
    }

    while (state.pendingAudioChunks.length > 0) {
      const entry = state.pendingAudioChunks[0];

      if (!entry) {
        const error = new Error(
          'Buffered STT audio flush lost track of the next queued chunk',
        );
        trace('stt.buffered_audio.flush_failed', {
          reason: 'queue_corrupted',
          state: getVoiceState(),
          pendingBufferedAudioMs: state.pendingAudioDurationMs,
          message: error.message,
        });
        reportError(error);
        return;
      }

      if (getVoiceState() !== 'listening') {
        traceFlushStopped('state_changed', entry);
        return;
      }

      if (!stt.isConnected()) {
        traceFlushStopped('stt_disconnected', entry);
        return;
      }

      try {
        markHasSentAudioForTurn();
        trace(traceEvent, {
          bytes: entry.chunk.data.length,
          sampleRate: entry.chunk.sampleRate,
          encoding: entry.chunk.encoding,
          remainingBufferedAudioMs:
            state.pendingAudioDurationMs - entry.durationMs,
        });
        stt.sendAudio(entry.chunk);
      } catch (error) {
        shiftBufferedAudio();
        const replacedPendingDropEvent = addDroppedDuration(
          entry.bufferingReason,
          entry.durationMs,
        );

        if (replacedPendingDropEvent) {
          emitDroppedEventIfActive(replacedPendingDropEvent);
        }

        scheduleDropDebounce();

        const normalizedError =
          error instanceof Error
            ? error
            : new Error(String(error), { cause: error });
        trace('stt.buffered_audio.flush_failed', {
          reason: 'send_failed',
          state: getVoiceState(),
          pendingBufferedAudioMs: state.pendingAudioDurationMs,
          nextBufferedAudioSequence: entry.chunk.sequence ?? null,
          nextBufferedAudioTimestamp: entry.chunk.timestamp,
          flushFailedChunkMs: entry.durationMs,
          message: normalizedError.message,
        });
        reportError(
          new Error('Failed to replay buffered STT audio chunk', {
            cause: normalizedError,
          }),
        );

        if (!stt.isConnected()) {
          return;
        }

        continue;
      }

      if (state.pendingAudioChunks[0] !== entry) {
        const error = new Error(
          'Buffered STT audio queue changed while replaying the next chunk',
        );
        trace('stt.buffered_audio.flush_failed', {
          reason: 'queue_mutated',
          state: getVoiceState(),
          pendingBufferedAudioMs: state.pendingAudioDurationMs,
          nextBufferedAudioSequence: entry.chunk.sequence ?? null,
          nextBufferedAudioTimestamp: entry.chunk.timestamp,
          message: error.message,
        });
        reportError(error);
        return;
      }

      shiftBufferedAudio();
    }
  }

  function dropNonListeningChunk({
    voiceState,
    chunk,
    normalizeError,
  }: DropNonListeningAudioChunkOptions) {
    const error = new Error(
      `Cannot accept audio chunk while voice session is ${voiceState}`,
    );

    try {
      const droppedDurationMs = measureAudioChunkDurationMs(chunk);
      if (Number.isFinite(droppedDurationMs) && droppedDurationMs > 0) {
        const replacedPendingDropEvent = addDroppedDuration(
          'state_not_listening',
          droppedDurationMs,
        );
        if (replacedPendingDropEvent) {
          emitDroppedEventIfActive(replacedPendingDropEvent);
        }
        scheduleDropDebounce();
      }
    } catch (durationError) {
      const normalizedDurationError = normalizeError(durationError);
      error.cause = normalizedDurationError;
      trace('stt.audio.dropped.duration_unavailable', {
        bytes: chunk.data.length,
        sampleRate: chunk.sampleRate,
        encoding: chunk.encoding,
        state: voiceState,
        message: normalizedDurationError.message,
      });
    }

    trace('stt.audio.dropped', {
      bytes: chunk.data.length,
      sampleRate: chunk.sampleRate,
      encoding: chunk.encoding,
      state: voiceState,
      message: error.message,
    });

    reportError(error);
  }

  return {
    push,
    replay,
    clear,
    reset,
    isEmpty() {
      return state.pendingAudioChunks.length === 0;
    },
    getBufferedDurationMs() {
      return state.pendingAudioDurationMs;
    },
    getDropEvent() {
      return state.pendingAudioDropEvent;
    },
    addDroppedDuration,
    scheduleDropDebounce,
    flushDropEvent,
    discardDropEvent,
    dropNonListeningChunk,
  };
}
