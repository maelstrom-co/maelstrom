import { afterEach, describe, expect, type Mock, spyOn, test } from 'bun:test';
import type { TelemetrySink } from '@maelstrom-co/telemetry';

import {
  createAudioBufferQueue,
  defaultAudioDropDebounceMs,
  measureAudioChunkDurationMs,
} from './audio-buffer-queue.js';
import { createVoiceSessionEvents } from './voice-session-events.js';
import type { AudioChunk, VoiceSessionAudioDroppedEvent } from './types.js';

interface TimerStub {
  id: number;
  callback: () => void;
  delay: number;
}

interface TimerHarness {
  scheduledTimers: TimerStub[];
  clearedTimers: number[];
  setTimeoutSpy: Mock<typeof setTimeout>;
  clearTimeoutSpy: Mock<typeof clearTimeout>;
  fireTimer: (id: number) => void;
}

let setTimeoutSpy: Mock<typeof setTimeout> | undefined;
let clearTimeoutSpy: Mock<typeof clearTimeout> | undefined;

function installTimerHarness(): TimerHarness {
  const scheduledTimers: TimerStub[] = [];
  const clearedTimers: number[] = [];
  let nextTimerId = 1;

  setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: TimerHandler,
    delay?: number,
  ) => {
    const timer: TimerStub = {
      id: nextTimerId++,
      callback: callback as () => void,
      delay: delay ?? 0,
    };
    scheduledTimers.push(timer);
    return timer.id as unknown as Timer;
  }) as unknown as typeof setTimeout);

  clearTimeoutSpy = spyOn(globalThis, 'clearTimeout').mockImplementation(((
    timer: Timer | number | undefined,
  ) => {
    if (typeof timer === 'number') {
      clearedTimers.push(timer);
    }
  }) as typeof clearTimeout);

  return {
    scheduledTimers,
    clearedTimers,
    setTimeoutSpy,
    clearTimeoutSpy,
    fireTimer(id) {
      if (clearedTimers.includes(id)) {
        return;
      }

      const timer = scheduledTimers.find((candidate) => candidate.id === id);
      timer?.callback();
    },
  };
}

function makeOpusChunkWithoutBytesPerSample(sequence: number): AudioChunk {
  return {
    data: Uint8Array.from([1, 2, 3, 4]),
    sampleRate: 48000,
    encoding: 'opus',
    timestamp: sequence,
    sequence,
  };
}

function makeLinear16Chunk(sequence: number): AudioChunk {
  return {
    data: new Uint8Array(32),
    sampleRate: 16000,
    encoding: 'linear16',
    bytesPerSample: 2,
    channels: 1,
    timestamp: sequence,
    sequence,
  };
}

function createTelemetryRecorder() {
  const recordedMetrics: Array<Record<string, unknown>> = [];
  const recordedTimings: Array<Record<string, unknown>> = [];

  const sink: TelemetrySink = {
    emitEvent() {},
    recordMetric(metric) {
      recordedMetrics.push(metric as unknown as Record<string, unknown>);
    },
    recordTiming(timing) {
      recordedTimings.push(timing as unknown as Record<string, unknown>);
    },
  };

  return {
    sink,
    recordedMetrics,
    recordedTimings,
  };
}

function createAudioDropTelemetryContext() {
  const callbackEvents: VoiceSessionAudioDroppedEvent[] = [];
  const listenerEvents: VoiceSessionAudioDroppedEvent[] = [];
  const telemetry = createTelemetryRecorder();

  const events = createVoiceSessionEvents(
    {
      onAudioDropped(event) {
        callbackEvents.push(event);
      },
    },
    undefined,
    telemetry.sink,
  );

  events.onAudioDropped((event) => {
    listenerEvents.push(event);
  });

  const queue = createAudioBufferQueue({
    audioBufferMaxMs: 5,
    trace() {},
    reportError() {},
    emitAudioDropped: events.emitAudioDropped,
    isDestroyed: events.isDestroyed,
  });

  return {
    queue,
    events,
    telemetry,
    listenerEvents,
    callbackEvents,
  };
}

function createDropQueueTestContext() {
  const emittedEvents: VoiceSessionAudioDroppedEvent[] = [];
  const reportedErrors: Error[] = [];
  const traceEvents: Array<{
    event: string;
    details?: Record<string, unknown>;
  }> = [];
  let destroyed = false;

  const queue = createAudioBufferQueue({
    audioBufferMaxMs: 5,
    trace(event, details) {
      traceEvents.push({ event, details });
    },
    reportError(error) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    emitAudioDropped(event) {
      emittedEvents.push(event);
    },
    isDestroyed() {
      return destroyed;
    },
  });

  return {
    queue,
    emittedEvents,
    reportedErrors,
    traceEvents,
    setDestroyed(value: boolean) {
      destroyed = value;
    },
  };
}

describe('audio-buffer-queue dropped-audio accounting', () => {
  afterEach(() => {
    setTimeoutSpy?.mockRestore();
    clearTimeoutSpy?.mockRestore();
    setTimeoutSpy = undefined;
    clearTimeoutSpy = undefined;
  });

  test('uses the shared drop debounce window', () => {
    expect(defaultAudioDropDebounceMs).toBe(100);
  });

  test('returns without replacing the bucket when the same reason is added', () => {
    const { queue } = createDropQueueTestContext();

    queue.addDroppedDuration('pre_connection_buffer_full', 3);
    const replacedEvent = queue.addDroppedDuration(
      'pre_connection_buffer_full',
      4,
    );

    expect(replacedEvent).toBeNull();
    expect(queue.getDropEvent()).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 7,
    });
  });

  test('replaces the bucket when the reason changes', () => {
    const { queue } = createDropQueueTestContext();

    queue.addDroppedDuration('pre_connection_buffer_full', 3);

    const replacedEvent = queue.addDroppedDuration('reconnect_buffer_full', 4);

    expect(replacedEvent).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    });
    expect(queue.getDropEvent()).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 4,
    });
  });

  test('clears and replaces the debounce timeout when the reason changes', () => {
    const { queue, emittedEvents } = createDropQueueTestContext();
    const timerHarness = installTimerHarness();

    queue.addDroppedDuration('pre_connection_buffer_full', 3);
    queue.scheduleDropDebounce();

    expect(timerHarness.setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timerHarness.scheduledTimers).toEqual([
      expect.objectContaining({ id: 1, delay: 100 }),
    ]);

    const replacedEvent = queue.addDroppedDuration('reconnect_buffer_full', 4);

    expect(replacedEvent).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    });
    expect(timerHarness.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timerHarness.clearedTimers).toEqual([1]);

    queue.scheduleDropDebounce();

    expect(timerHarness.setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(timerHarness.scheduledTimers).toEqual([
      expect.objectContaining({ id: 1, delay: 100 }),
      expect.objectContaining({ id: 2, delay: 100 }),
    ]);

    timerHarness.fireTimer(1);

    expect(emittedEvents).toEqual([]);
    expect(queue.getDropEvent()).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 4,
    });

    timerHarness.fireTimer(2);

    expect(queue.getDropEvent()).toBeNull();
    expect(emittedEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 4,
      },
    ]);
  });

  test('does not schedule a second timeout when one already exists', () => {
    const { queue, emittedEvents } = createDropQueueTestContext();
    const timerHarness = installTimerHarness();

    queue.addDroppedDuration('pre_connection_buffer_full', 3);
    queue.scheduleDropDebounce();
    queue.scheduleDropDebounce();

    expect(timerHarness.setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timerHarness.scheduledTimers).toEqual([
      expect.objectContaining({ id: 1, delay: 100 }),
    ]);

    timerHarness.fireTimer(1);

    expect(queue.getDropEvent()).toBeNull();
    expect(emittedEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);
  });

  test('treats a null pending event as a scheduling no-op', () => {
    const { queue, emittedEvents } = createDropQueueTestContext();

    queue.scheduleDropDebounce();

    expect(queue.getDropEvent()).toBeNull();
    expect(emittedEvents).toHaveLength(0);
  });

  test('clears timeout and pending event when discarding the bucket', () => {
    const { queue } = createDropQueueTestContext();
    const timerHarness = installTimerHarness();

    queue.addDroppedDuration('pre_connection_buffer_full', 3);
    queue.scheduleDropDebounce();
    queue.discardDropEvent();

    expect(queue.getDropEvent()).toBeNull();
    expect(timerHarness.clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('flushes destroyed-state buckets silently', () => {
    const { queue, emittedEvents, setDestroyed } = createDropQueueTestContext();

    queue.addDroppedDuration('reconnect_buffer_full', 4);
    setDestroyed(true);
    queue.flushDropEvent();

    expect(queue.getDropEvent()).toBeNull();
    expect(emittedEvents).toHaveLength(0);
  });

  test('preserves the original state-not-listening runtime error while attaching a duration-unavailable cause', () => {
    const { queue, emittedEvents, reportedErrors, traceEvents } =
      createDropQueueTestContext();

    queue.dropNonListeningChunk({
      voiceState: 'speaking',
      chunk: makeOpusChunkWithoutBytesPerSample(1),
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
    });

    expect(emittedEvents).toEqual([]);
    expect(queue.getDropEvent()).toBeNull();
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe(
      'Cannot accept audio chunk while voice session is speaking',
    );
    expect(reportedErrors[0]?.cause).toBeInstanceOf(Error);
    expect((reportedErrors[0]?.cause as Error | undefined)?.message).toBe(
      'Opus audio chunks must provide bytesPerSample before buffering so duration can be estimated safely',
    );
    expect(reportedErrors[0]?.stack).toContain(
      'Cannot accept audio chunk while voice session is speaking',
    );
    expect(reportedErrors[0]?.stack).not.toContain(
      'Opus audio chunks must provide bytesPerSample before buffering so duration can be estimated safely',
    );
    expect(traceEvents).toContainEqual({
      event: 'stt.audio.dropped.duration_unavailable',
      details: expect.objectContaining({
        state: 'speaking',
        encoding: 'opus',
        sampleRate: 48000,
        message:
          'Opus audio chunks must provide bytesPerSample before buffering so duration can be estimated safely',
      }),
    });
    expect(traceEvents).toContainEqual({
      event: 'stt.audio.dropped',
      details: expect.objectContaining({
        state: 'speaking',
        encoding: 'opus',
        sampleRate: 48000,
        message: 'Cannot accept audio chunk while voice session is speaking',
      }),
    });
  });

  test('measures and buckets dropped audio when a non-listening chunk has a valid duration', () => {
    const { queue, emittedEvents, reportedErrors } =
      createDropQueueTestContext();
    const timerHarness = installTimerHarness();

    queue.dropNonListeningChunk({
      voiceState: 'processing',
      chunk: {
        data: new Uint8Array(32),
        sampleRate: 16000,
        encoding: 'linear16',
        bytesPerSample: 2,
        channels: 1,
        timestamp: 1,
        sequence: 1,
      },
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
    });

    expect(queue.getDropEvent()).toEqual({
      type: 'audio_dropped',
      reason: 'state_not_listening',
      droppedDurationMs: 1,
    });
    expect(reportedErrors[0]?.message).toBe(
      'Cannot accept audio chunk while voice session is processing',
    );

    timerHarness.fireTimer(1);

    expect(queue.getDropEvent()).toBeNull();
    expect(emittedEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'state_not_listening',
        droppedDurationMs: 1,
      },
    ]);
  });

  test('keeps measureAudioChunkDurationMs shared with the drop path', () => {
    const durationMs = measureAudioChunkDurationMs({
      data: new Uint8Array(32),
      sampleRate: 16000,
      encoding: 'linear16',
      bytesPerSample: 2,
      channels: 1,
      timestamp: 1,
      sequence: 1,
    });

    expect(durationMs).toBe(1);
  });

  test('records one telemetry count and timing pair for one debounced audio-drop bucket', () => {
    const { queue, listenerEvents, callbackEvents, telemetry } =
      createAudioDropTelemetryContext();
    const timerHarness = installTimerHarness();

    queue.dropNonListeningChunk({
      voiceState: 'processing',
      chunk: makeLinear16Chunk(1),
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
    });
    queue.dropNonListeningChunk({
      voiceState: 'processing',
      chunk: makeLinear16Chunk(2),
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
    });
    queue.dropNonListeningChunk({
      voiceState: 'processing',
      chunk: makeLinear16Chunk(3),
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
    });

    expect(listenerEvents).toHaveLength(0);
    expect(callbackEvents).toHaveLength(0);

    timerHarness.fireTimer(1);

    const deliveredEvent: VoiceSessionAudioDroppedEvent = {
      type: 'audio_dropped',
      reason: 'state_not_listening',
      droppedDurationMs: 3,
    };

    expect(listenerEvents).toEqual([deliveredEvent]);
    expect(callbackEvents).toEqual([deliveredEvent]);
    expect(telemetry.recordedMetrics).toEqual([
      expect.objectContaining({
        name: 'maelstrom.voice_server.audio.dropped_count',
        kind: 'counter',
        value: 1,
        unit: 'count',
        attributes: { reason: 'state_not_listening' },
      }),
    ]);
    expect(telemetry.recordedTimings).toEqual([
      expect.objectContaining({
        name: 'maelstrom.voice_server.audio.dropped_duration',
        duration: 3,
        unit: 'ms',
        attributes: { reason: 'state_not_listening' },
      }),
    ]);

    expect(Object.keys(telemetry.recordedMetrics[0]?.attributes ?? {})).toEqual([
      'reason',
    ]);
    expect(Object.keys(telemetry.recordedTimings[0]?.attributes ?? {})).toEqual([
      'reason',
    ]);

    for (const recorded of [
      telemetry.recordedMetrics[0],
      telemetry.recordedTimings[0],
    ]) {
      expect(recorded).not.toHaveProperty('bytes');
      expect(recorded).not.toHaveProperty('chunk');
      expect(recorded).not.toHaveProperty('sequence');
      expect(recorded).not.toHaveProperty('sampleRate');
      expect(recorded).not.toHaveProperty('encoding');
      expect(recorded).not.toHaveProperty('sessionId');
      expect(recorded).not.toHaveProperty('requestId');
      expect(recorded).not.toHaveProperty('text');
      expect(recorded).not.toHaveProperty('preview');
      expect(recorded).not.toHaveProperty('provider');
      expect(recorded).not.toHaveProperty('raw');
    }
  });

  test('suppresses pending audio-drop delivery and telemetry when destroyed before debounce fires', () => {
    const { queue, events, listenerEvents, callbackEvents, telemetry } =
      createAudioDropTelemetryContext();
    const timerHarness = installTimerHarness();

    queue.dropNonListeningChunk({
      voiceState: 'processing',
      chunk: makeLinear16Chunk(1),
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
    });

    events.destroy();
    timerHarness.fireTimer(1);

    expect(listenerEvents).toHaveLength(0);
    expect(callbackEvents).toHaveLength(0);
    expect(telemetry.recordedMetrics).toHaveLength(0);
    expect(telemetry.recordedTimings).toHaveLength(0);
  });

  test('keeps listener and callback delivery intact when the telemetry sink throws', () => {
    const listenerEvents: VoiceSessionAudioDroppedEvent[] = [];
    const callbackEvents: VoiceSessionAudioDroppedEvent[] = [];
    const events = createVoiceSessionEvents(
      {
        onAudioDropped(event) {
          callbackEvents.push(event);
        },
      },
      undefined,
      {
        emitEvent() {},
        recordMetric() {
          throw new Error('metric sink failed');
        },
        recordTiming() {
          throw new Error('timing sink failed');
        },
      },
    );

    events.onAudioDropped((event) => {
      listenerEvents.push(event);
    });

    const event: VoiceSessionAudioDroppedEvent = {
      type: 'audio_dropped',
      reason: 'state_not_listening',
      droppedDurationMs: 3,
    };

    expect(() => events.emitAudioDropped(event)).not.toThrow();
    expect(listenerEvents).toEqual([event]);
    expect(callbackEvents).toEqual([event]);
  });
});
