import { describe, expect, test } from 'bun:test';
import {
  bufferAudioChunk,
  flushBufferedAudio,
  measureAudioChunkDurationMs,
  type VoiceRuntimeAudioBufferContext,
} from './runtime.audio-buffer.js';
import { createInitialVoiceRuntimeState } from './runtime.state.js';
import type {
  AudioChunk,
  STTEvent,
  STTProvider,
  VoiceSessionAudioDroppedEvent,
} from './types.js';

class MockSTTProvider implements STTProvider {
  readonly name = 'mock-stt';
  readonly capabilities = {
    interimTranscripts: true,
  };

  readonly sentAudioChunks: AudioChunk[] = [];

  private connected = true;
  private readonly listeners = new Set<(event: STTEvent) => void>();
  private sendAttempts = 0;

  constructor(
    private readonly options: {
      throwOnSendCounts?: number[];
      disconnectOnSendCounts?: number[];
    } = {},
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  sendAudio(chunk: AudioChunk): void {
    this.sendAttempts += 1;

    if (this.options.throwOnSendCounts?.includes(this.sendAttempts)) {
      throw new Error('mock replay send failure');
    }

    this.sentAudioChunks.push(chunk);

    if (this.options.disconnectOnSendCounts?.includes(this.sendAttempts)) {
      this.connected = false;
    }
  }

  endStream(): void {}

  onEvent(callback: (event: STTEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

function makeLinear16Chunk(ms: number, sequence: number): AudioChunk {
  return {
    data: new Uint8Array(ms * 32),
    sampleRate: 16000,
    encoding: 'linear16',
    bytesPerSample: 2,
    channels: 1,
    timestamp: sequence,
    sequence,
  };
}

function createBufferTestContext(audioBufferMaxMs = 5) {
  const state = createInitialVoiceRuntimeState();
  const traces: Array<{ event: string; details?: Record<string, unknown> }> =
    [];
  const reportedErrors: Error[] = [];
  const emittedDropEvents: VoiceSessionAudioDroppedEvent[] = [];
  let scheduledNotifications = 0;

  const context: VoiceRuntimeAudioBufferContext = {
    state,
    audioBufferMaxMs,
    trace(event, details) {
      traces.push({ event, details });
    },
    reportError(error) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    emitPendingAudioDropEvent(event) {
      emittedDropEvents.push(event);
    },
    schedulePendingAudioDropNotification() {
      scheduledNotifications += 1;
    },
  };

  return {
    context,
    state,
    traces,
    reportedErrors,
    emittedDropEvents,
    getScheduledNotifications() {
      return scheduledNotifications;
    },
  };
}

function seedBufferedAudio(
  context: VoiceRuntimeAudioBufferContext,
  entries: Array<{
    chunk: AudioChunk;
    durationMs: number;
    bufferingReason: 'pre_connection_buffer_full' | 'reconnect_buffer_full';
  }>,
) {
  context.state.pendingAudioChunks.push(...entries);
  context.state.pendingAudioDurationMs = entries.reduce(
    (total, entry) => total + entry.durationMs,
    0,
  );
}

describe('runtime.audio-buffer helpers', () => {
  test('measures linear16 chunk duration with default bytes per sample', () => {
    expect(measureAudioChunkDurationMs(makeLinear16Chunk(3, 1))).toBe(3);
  });

  test('measures opus chunk duration when bytesPerSample is supplied explicitly', () => {
    const durationMs = measureAudioChunkDurationMs({
      data: new Uint8Array(8000),
      sampleRate: 1000,
      encoding: 'opus',
      bytesPerSample: 4,
      channels: 2,
      timestamp: 1,
      sequence: 1,
    });

    expect(durationMs).toBe(1000);
  });

  test('rejects buffering when chunk duration is invalid', () => {
    const { context, state, traces, reportedErrors, emittedDropEvents } =
      createBufferTestContext();

    const buffered = bufferAudioChunk(
      context,
      {
        data: new Uint8Array(0),
        sampleRate: 16000,
        encoding: 'linear16',
        bytesPerSample: 2,
        channels: 1,
        timestamp: 1,
        sequence: 1,
      },
      'pre_connection_buffer_full',
      'stt.audio.buffered',
      { source: 'unit-test' },
    );

    expect(buffered).toBe(false);
    expect(state.pendingAudioChunks).toEqual([]);
    expect(state.pendingAudioDurationMs).toBe(0);
    expect(emittedDropEvents).toEqual([]);
    expect(reportedErrors.map((error) => error.message)).toEqual([
      'STT audio chunk duration must be positive, received 0ms',
    ]);
    expect(traces).toContainEqual({
      event: 'stt.audio.buffer_rejected',
      details: expect.objectContaining({
        source: 'unit-test',
        reason: 'invalid_duration',
        chunkDurationMs: 0,
        pendingBufferedAudioMs: 0,
        audioBufferMaxMs: 5,
      }),
    });
  });

  test('flushes a previous drop event when an oversized chunk changes overflow reason', () => {
    const {
      context,
      state,
      traces,
      reportedErrors,
      emittedDropEvents,
      getScheduledNotifications,
    } = createBufferTestContext();

    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    };

    seedBufferedAudio(context, [
      {
        chunk: makeLinear16Chunk(3, 1),
        durationMs: 3,
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);

    const buffered = bufferAudioChunk(
      context,
      makeLinear16Chunk(8, 2),
      'reconnect_buffer_full',
      'stt.audio.buffered',
      { source: 'unit-test' },
    );

    expect(buffered).toBe(false);
    expect(state.pendingAudioChunks).toEqual([]);
    expect(state.pendingAudioDurationMs).toBe(0);
    expect(state.pendingAudioDropEvent).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 11,
    });
    expect(emittedDropEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);
    expect(getScheduledNotifications()).toBe(1);
    expect(reportedErrors.map((error) => error.message)).toEqual([
      'Dropped 11ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
    ]);
    expect(traces).toContainEqual({
      event: 'stt.audio.buffer_overflow',
      details: expect.objectContaining({
        source: 'unit-test',
        droppedDurationMs: 11,
        chunkDurationMs: 8,
        pendingBufferedAudioMs: 0,
        audioBufferMaxMs: 5,
      }),
    });
  });

  test('replays buffered audio in FIFO order and drains buffered duration', () => {
    const { context, state, traces, reportedErrors, emittedDropEvents } =
      createBufferTestContext();
    const stt = new MockSTTProvider();

    state.state = 'listening';
    seedBufferedAudio(context, [
      {
        chunk: makeLinear16Chunk(1, 1),
        durationMs: 1,
        bufferingReason: 'pre_connection_buffer_full',
      },
      {
        chunk: makeLinear16Chunk(2, 2),
        durationMs: 2,
        bufferingReason: 'pre_connection_buffer_full',
      },
      {
        chunk: makeLinear16Chunk(3, 3),
        durationMs: 3,
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);

    flushBufferedAudio(context, stt, 'stt.buffered_audio.replayed');

    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(state.pendingAudioChunks).toEqual([]);
    expect(state.pendingAudioDurationMs).toBe(0);
    expect(reportedErrors).toEqual([]);
    expect(emittedDropEvents).toEqual([]);
    expect(
      traces
        .filter((entry) => entry.event === 'stt.buffered_audio.replayed')
        .map((entry) => entry.details?.remainingBufferedAudioMs),
    ).toEqual([5, 3, 0]);
  });

  test('drops a failed replay chunk, schedules notification, and continues with later chunks while connected', () => {
    const {
      context,
      state,
      traces,
      reportedErrors,
      emittedDropEvents,
      getScheduledNotifications,
    } = createBufferTestContext();
    const stt = new MockSTTProvider({ throwOnSendCounts: [1] });

    state.state = 'listening';
    seedBufferedAudio(context, [
      {
        chunk: makeLinear16Chunk(1, 1),
        durationMs: 1,
        bufferingReason: 'reconnect_buffer_full',
      },
      {
        chunk: makeLinear16Chunk(2, 2),
        durationMs: 2,
        bufferingReason: 'reconnect_buffer_full',
      },
    ]);

    flushBufferedAudio(context, stt, 'stt.buffered_audio.replayed');

    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
    expect(state.pendingAudioChunks).toEqual([]);
    expect(state.pendingAudioDurationMs).toBe(0);
    expect(state.pendingAudioDropEvent).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 1,
    });
    expect(getScheduledNotifications()).toBe(1);
    expect(emittedDropEvents).toEqual([]);
    expect(reportedErrors.map((error) => error.message)).toEqual([
      'Failed to replay buffered STT audio chunk',
    ]);
    expect(reportedErrors[0]?.cause).toBeInstanceOf(Error);
    expect((reportedErrors[0]?.cause as Error | undefined)?.message).toBe(
      'mock replay send failure',
    );
    expect(traces).toContainEqual({
      event: 'stt.buffered_audio.flush_failed',
      details: expect.objectContaining({
        reason: 'send_failed',
        nextBufferedAudioSequence: 1,
        flushFailedChunkMs: 1,
        pendingBufferedAudioMs: 2,
        message: 'mock replay send failure',
      }),
    });
    expect(traces).toContainEqual({
      event: 'stt.buffered_audio.replayed',
      details: expect.objectContaining({
        remainingBufferedAudioMs: 0,
      }),
    });
  });

  test('schedules notification when overflow drops buffered audio but still buffers the new chunk', () => {
    const {
      context,
      state,
      reportedErrors,
      emittedDropEvents,
      getScheduledNotifications,
    } = createBufferTestContext();

    seedBufferedAudio(context, [
      {
        chunk: makeLinear16Chunk(4, 1),
        durationMs: 4,
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);

    const buffered = bufferAudioChunk(
      context,
      makeLinear16Chunk(4, 2),
      'pre_connection_buffer_full',
      'stt.audio.buffered',
      { source: 'unit-test' },
    );

    expect(buffered).toBe(true);
    expect(
      state.pendingAudioChunks.map((entry) => entry.chunk.sequence),
    ).toEqual([2]);
    expect(state.pendingAudioDurationMs).toBe(4);
    expect(state.pendingAudioDropEvent).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 4,
    });
    expect(emittedDropEvents).toEqual([]);
    expect(getScheduledNotifications()).toBe(1);
    expect(reportedErrors.map((error) => error.message)).toEqual([
      'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
    ]);
  });
});
