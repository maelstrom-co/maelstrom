import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  createAudioBufferQueue,
  measureAudioChunkDurationMs,
} from './audio-buffer-queue.js';
import type {
  AudioChunk,
  STTEvent,
  STTProvider,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionState,
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

function createBufferQueueTestContext(audioBufferMaxMs = 5) {
  const traces: Array<{ event: string; details?: Record<string, unknown> }> =
    [];
  const reportedErrors: Error[] = [];
  const emittedDropEvents: VoiceSessionAudioDroppedEvent[] = [];
  let destroyed = false;
  let voiceState: VoiceSessionState = 'listening';
  let replayMarkedSentCount = 0;

  const queue = createAudioBufferQueue({
    audioBufferMaxMs,
    trace(event, details) {
      traces.push({ event, details });
    },
    reportError(error) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    emitAudioDropped(event) {
      emittedDropEvents.push(event);
    },
    isDestroyed() {
      return destroyed;
    },
  });

  return {
    queue,
    traces,
    reportedErrors,
    emittedDropEvents,
    setDestroyed(value: boolean) {
      destroyed = value;
    },
    setVoiceState(value: VoiceSessionState) {
      voiceState = value;
    },
    replay(stt: STTProvider, traceEvent: string) {
      queue.replay({
        stt,
        traceEvent,
        getVoiceState: () => voiceState,
        markHasSentAudioForTurn: () => {
          replayMarkedSentCount += 1;
        },
      });
    },
    getReplayMarkedSentCount() {
      return replayMarkedSentCount;
    },
  };
}

function seedBufferedAudio(
  queue: ReturnType<typeof createAudioBufferQueue>,
  entries: Array<{
    chunk: AudioChunk;
    bufferingReason: 'pre_connection_buffer_full' | 'reconnect_buffer_full';
  }>,
) {
  for (const entry of entries) {
    const buffered = queue.push(entry.chunk, entry.bufferingReason, 'seed', {
      source: 'seed',
    });

    expect(buffered).toBe(true);
  }
}

describe('audio-buffer-queue buffering and replay', () => {
  test('exports the dedicated audio buffer queue kernel factory', async () => {
    const module = await import('./audio-buffer-queue.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(typeof module?.createAudioBufferQueue).toBe('function');
  });

  test('runtime delegates buffering through the queue kernel instead of helper modules', () => {
    const runtimeSource = readFileSync(
      new URL('./runtime.ts', import.meta.url),
      'utf8',
    );

    expect(runtimeSource).not.toContain("'./runtime.audio-buffer.js'");
    expect(runtimeSource).not.toContain("'./runtime.audio-drop.js'");
  });

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
    const { queue, traces, reportedErrors, emittedDropEvents } =
      createBufferQueueTestContext();

    const buffered = queue.push(
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
    expect(queue.isEmpty()).toBe(true);
    expect(queue.getBufferedDurationMs()).toBe(0);
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
    const { queue, traces, reportedErrors, emittedDropEvents } =
      createBufferQueueTestContext();

    queue.addDroppedDuration('pre_connection_buffer_full', 3);
    seedBufferedAudio(queue, [
      {
        chunk: makeLinear16Chunk(3, 1),
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);

    const buffered = queue.push(
      makeLinear16Chunk(8, 2),
      'reconnect_buffer_full',
      'stt.audio.buffered',
      { source: 'unit-test' },
    );

    expect(buffered).toBe(false);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.getBufferedDurationMs()).toBe(0);
    expect(queue.getDropEvent()).toEqual({
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
    const { queue, traces, reportedErrors, emittedDropEvents, replay } =
      createBufferQueueTestContext(10);
    const stt = new MockSTTProvider();

    seedBufferedAudio(queue, [
      {
        chunk: makeLinear16Chunk(1, 1),
        bufferingReason: 'pre_connection_buffer_full',
      },
      {
        chunk: makeLinear16Chunk(2, 2),
        bufferingReason: 'pre_connection_buffer_full',
      },
      {
        chunk: makeLinear16Chunk(3, 3),
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);

    replay(stt, 'stt.buffered_audio.replayed');

    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.getBufferedDurationMs()).toBe(0);
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
      queue,
      traces,
      reportedErrors,
      emittedDropEvents,
      replay,
      getReplayMarkedSentCount,
    } = createBufferQueueTestContext(10);
    const stt = new MockSTTProvider({ throwOnSendCounts: [1] });

    seedBufferedAudio(queue, [
      {
        chunk: makeLinear16Chunk(1, 1),
        bufferingReason: 'reconnect_buffer_full',
      },
      {
        chunk: makeLinear16Chunk(2, 2),
        bufferingReason: 'reconnect_buffer_full',
      },
    ]);

    replay(stt, 'stt.buffered_audio.replayed');

    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.getBufferedDurationMs()).toBe(0);
    expect(queue.getDropEvent()).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 1,
    });
    expect(getReplayMarkedSentCount()).toBe(2);
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
    const { queue, reportedErrors, emittedDropEvents } =
      createBufferQueueTestContext();

    seedBufferedAudio(queue, [
      {
        chunk: makeLinear16Chunk(4, 1),
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);

    const buffered = queue.push(
      makeLinear16Chunk(4, 2),
      'pre_connection_buffer_full',
      'stt.audio.buffered',
      { source: 'unit-test' },
    );

    expect(buffered).toBe(true);
    expect(queue.isEmpty()).toBe(false);
    expect(queue.getBufferedDurationMs()).toBe(4);
    expect(queue.getDropEvent()).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 4,
    });
    expect(emittedDropEvents).toEqual([]);
    expect(reportedErrors.map((error) => error.message)).toEqual([
      'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
    ]);
  });

  test('replay stops cleanly when the runtime is no longer listening', () => {
    const { queue, traces, replay, setVoiceState } =
      createBufferQueueTestContext(10);
    const stt = new MockSTTProvider();

    seedBufferedAudio(queue, [
      {
        chunk: makeLinear16Chunk(1, 1),
        bufferingReason: 'pre_connection_buffer_full',
      },
    ]);
    setVoiceState('processing');

    replay(stt, 'stt.buffered_audio.replayed');

    expect(stt.sentAudioChunks).toEqual([]);
    expect(queue.getBufferedDurationMs()).toBe(1);
    expect(traces).toContainEqual({
      event: 'stt.buffered_audio.flush_stopped',
      details: expect.objectContaining({
        reason: 'state_changed',
        state: 'processing',
        pendingBufferedAudioMs: 1,
      }),
    });
  });
});
