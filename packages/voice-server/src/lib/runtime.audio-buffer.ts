import { addPendingDroppedDuration } from './runtime.audio-drop.js';
import type { BufferedAudioChunk, VoiceRuntimeState } from './runtime.state.js';
import type {
  AudioChunk,
  AudioEncoding,
  STTProvider,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionAudioDropReason,
} from './types.js';

export interface VoiceRuntimeAudioBufferContext {
  state: VoiceRuntimeState;
  audioBufferMaxMs: number;
  trace: (event: string, details?: Record<string, unknown>) => void;
  reportError: (error: unknown) => void;
  emitPendingAudioDropEvent: (event: VoiceSessionAudioDroppedEvent) => void;
  schedulePendingAudioDropNotification: () => void;
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

function shiftBufferedAudio(
  state: VoiceRuntimeState,
): BufferedAudioChunk | undefined {
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

export function flushBufferedAudio(
  context: VoiceRuntimeAudioBufferContext,
  stt: STTProvider,
  traceEvent: string,
) {
  const {
    state,
    trace,
    reportError,
    emitPendingAudioDropEvent,
    schedulePendingAudioDropNotification,
  } = context;

  function traceFlushStopped(
    reason: 'stt_disconnected' | 'state_changed',
    entry: BufferedAudioChunk,
  ) {
    trace('stt.buffered_audio.flush_stopped', {
      reason,
      state: state.state,
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
        state: state.state,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
        message: error.message,
      });
      reportError(error);
      return;
    }

    if (state.state !== 'listening') {
      traceFlushStopped('state_changed', entry);
      return;
    }

    if (!stt.isConnected()) {
      traceFlushStopped('stt_disconnected', entry);
      return;
    }

    try {
      trace(traceEvent, {
        bytes: entry.chunk.data.length,
        sampleRate: entry.chunk.sampleRate,
        encoding: entry.chunk.encoding,
        remainingBufferedAudioMs:
          state.pendingAudioDurationMs - entry.durationMs,
      });
      stt.sendAudio(entry.chunk);
    } catch (error) {
      shiftBufferedAudio(state);
      const replacedPendingDropEvent = addPendingDroppedDuration(
        state,
        entry.bufferingReason,
        entry.durationMs,
      );

      if (replacedPendingDropEvent) {
        emitPendingAudioDropEvent(replacedPendingDropEvent);
      }

      schedulePendingAudioDropNotification();

      const normalizedError =
        error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      trace('stt.buffered_audio.flush_failed', {
        reason: 'send_failed',
        state: state.state,
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
      // WHY: The queue is expected to behave like a strict FIFO while replaying. If the head changes
      // under us, some other code path is mutating buffered audio concurrently and replay order can no
      // longer be trusted.
      const error = new Error(
        'Buffered STT audio queue changed while replaying the next chunk',
      );
      trace('stt.buffered_audio.flush_failed', {
        reason: 'queue_mutated',
        state: state.state,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
        nextBufferedAudioSequence: entry.chunk.sequence ?? null,
        nextBufferedAudioTimestamp: entry.chunk.timestamp,
        message: error.message,
      });
      reportError(error);
      return;
    }

    shiftBufferedAudio(state);
  }
}

export function bufferAudioChunk(
  context: VoiceRuntimeAudioBufferContext,
  chunk: AudioChunk,
  dropReason: VoiceSessionAudioDropReason,
  traceEvent: string,
  traceDetails: Record<string, unknown>,
): boolean {
  const {
    state,
    audioBufferMaxMs,
    reportError,
    trace,
    emitPendingAudioDropEvent,
    schedulePendingAudioDropNotification,
  } = context;

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
    const droppedEntry = shiftBufferedAudio(state);

    if (!droppedEntry) {
      droppedDurationMs += durationMs;
      const replacedPendingDropEvent = addPendingDroppedDuration(
        state,
        dropReason,
        droppedDurationMs,
      );

      if (replacedPendingDropEvent) {
        emitPendingAudioDropEvent(replacedPendingDropEvent);
      }

      schedulePendingAudioDropNotification();

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
    const replacedPendingDropEvent = addPendingDroppedDuration(
      state,
      dropReason,
      droppedDurationMs,
    );

    if (replacedPendingDropEvent) {
      emitPendingAudioDropEvent(replacedPendingDropEvent);
    }

    schedulePendingAudioDropNotification();

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
