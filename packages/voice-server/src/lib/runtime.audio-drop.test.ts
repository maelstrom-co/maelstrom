import { afterEach, describe, expect, spyOn, test, type Mock } from 'bun:test';
import {
  addPendingDroppedDuration,
  discardPendingAudioDropEvent,
  flushPendingAudioDropEvent,
  handleNonListeningAudioChunkDrop,
  schedulePendingAudioDropNotification,
} from './runtime.audio-drop.js';
import { measureAudioChunkDurationMs } from './runtime.audio-buffer.js';
import { createInitialVoiceRuntimeState } from './runtime.state.js';
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

describe('runtime.audio-drop helpers', () => {
  afterEach(() => {
    setTimeoutSpy?.mockRestore();
    clearTimeoutSpy?.mockRestore();
    setTimeoutSpy = undefined;
    clearTimeoutSpy = undefined;
  });

  test('returns without replacing the bucket when the same reason is added', () => {
    const state = createInitialVoiceRuntimeState();

    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    };

    const replacedEvent = addPendingDroppedDuration(
      state,
      'pre_connection_buffer_full',
      4,
    );

    expect(replacedEvent).toBeNull();
    expect(state.pendingAudioDropEvent).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 7,
    });
  });

  test('replaces the bucket when the reason changes', () => {
    const state = createInitialVoiceRuntimeState();

    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    };

    const replacedEvent = addPendingDroppedDuration(
      state,
      'reconnect_buffer_full',
      4,
    );

    expect(replacedEvent).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    });
    expect(state.pendingAudioDropEvent).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 4,
    });
    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
  });

  test('clears and replaces the debounce timeout when the reason changes', () => {
    const state = createInitialVoiceRuntimeState();
    const emittedEvents: VoiceSessionAudioDroppedEvent[] = [];
    const emitAudioDropped = (event: VoiceSessionAudioDroppedEvent) => {
      emittedEvents.push(event);
    };
    const timerHarness = installTimerHarness();

    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    };

    schedulePendingAudioDropNotification(state, emitAudioDropped);
    const firstTimeout = state.pendingAudioDropDebounceTimeout;

    expect(timerHarness.setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timerHarness.scheduledTimers).toEqual([
      expect.objectContaining({ id: 1, delay: 100 }),
    ]);

    const replacedEvent = addPendingDroppedDuration(
      state,
      'reconnect_buffer_full',
      4,
    );

    expect(replacedEvent).toEqual({
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    });
    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
    expect(timerHarness.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timerHarness.clearedTimers).toEqual([1]);

    schedulePendingAudioDropNotification(state, emitAudioDropped);

    expect(state.pendingAudioDropDebounceTimeout).not.toBeNull();
    expect(state.pendingAudioDropDebounceTimeout).not.toBe(firstTimeout);
    expect(timerHarness.setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(timerHarness.scheduledTimers).toEqual([
      expect.objectContaining({ id: 1, delay: 100 }),
      expect.objectContaining({ id: 2, delay: 100 }),
    ]);

    timerHarness.fireTimer(1);

    expect(emittedEvents).toEqual([]);
    expect(state.pendingAudioDropEvent).toEqual({
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 4,
    });

    timerHarness.fireTimer(2);

    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
    expect(emittedEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 4,
      },
    ]);
  });

  test('does not schedule a second timeout when one already exists', () => {
    const state = createInitialVoiceRuntimeState();
    const emittedEvents: VoiceSessionAudioDroppedEvent[] = [];
    const emitAudioDropped = (event: VoiceSessionAudioDroppedEvent) => {
      emittedEvents.push(event);
    };
    const timerHarness = installTimerHarness();

    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    };

    schedulePendingAudioDropNotification(state, emitAudioDropped);
    const firstTimeout = state.pendingAudioDropDebounceTimeout;

    schedulePendingAudioDropNotification(state, emitAudioDropped);

    expect(timerHarness.setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timerHarness.scheduledTimers).toEqual([
      expect.objectContaining({ id: 1, delay: 100 }),
    ]);
    expect(state.pendingAudioDropDebounceTimeout).toBe(firstTimeout);

    timerHarness.fireTimer(1);

    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
    expect(emittedEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);
  });

  test('treats a null pending event as a scheduling no-op', () => {
    const state = createInitialVoiceRuntimeState();
    const emittedEvents: VoiceSessionAudioDroppedEvent[] = [];
    const emitAudioDropped = (event: VoiceSessionAudioDroppedEvent) => {
      emittedEvents.push(event);
    };

    schedulePendingAudioDropNotification(state, emitAudioDropped);

    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
    expect(emittedEvents).toHaveLength(0);
  });

  test('clears timeout and pending event when discarding the bucket', () => {
    const state = createInitialVoiceRuntimeState();

    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'pre_connection_buffer_full',
      droppedDurationMs: 3,
    };
    state.pendingAudioDropDebounceTimeout = setTimeout(() => {}, 100);

    discardPendingAudioDropEvent(state);

    expect(state.pendingAudioDropEvent).toBeNull();
    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
  });

  test('flushes destroyed-state buckets silently', () => {
    const state = createInitialVoiceRuntimeState();
    const emittedEvents: VoiceSessionAudioDroppedEvent[] = [];
    const emitAudioDropped = (event: VoiceSessionAudioDroppedEvent) => {
      emittedEvents.push(event);
    };

    state.destroyed = true;
    state.pendingAudioDropEvent = {
      type: 'audio_dropped',
      reason: 'reconnect_buffer_full',
      droppedDurationMs: 4,
    };

    flushPendingAudioDropEvent(state, emitAudioDropped);

    expect(state.pendingAudioDropEvent).toBeNull();
    expect(state.pendingAudioDropDebounceTimeout).toBeNull();
    expect(emittedEvents).toHaveLength(0);
  });

  test('preserves the original state-not-listening runtime error while attaching a duration-unavailable cause', () => {
    const state = createInitialVoiceRuntimeState();
    const reportedErrors: Error[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const emittedEvents: VoiceSessionAudioDroppedEvent[] = [];

    handleNonListeningAudioChunkDrop({
      state,
      voiceState: 'speaking',
      chunk: makeOpusChunkWithoutBytesPerSample(1),
      measureAudioChunkDurationMs,
      normalizeError(error) {
        return error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      },
      trace(event, details) {
        traceEvents.push({ event, details });
      },
      emitPendingAudioDropEvent(event) {
        emittedEvents.push(event);
      },
      reportError(error) {
        reportedErrors.push(error);
      },
    });

    expect(emittedEvents).toEqual([]);
    expect(state.pendingAudioDropEvent).toBeNull();
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
});
