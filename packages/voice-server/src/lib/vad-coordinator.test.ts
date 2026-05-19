import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import type { VADEvent } from './types.js';
import { createVADCoordinator } from './vad-coordinator.js';

function createEvent(type: VADEvent['type']): VADEvent {
  return {
    type,
    timestamp: 123,
    durationMs: 456,
  };
}

describe('createVADCoordinator', () => {
  let clock: FakeTimers.InstalledClock;

  beforeEach(() => {
    clock = FakeTimers.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('forwards VAD events to listeners, callbacks, and trace', () => {
    const listenerEvents: VADEvent[] = [];
    const callbackEvents: VADEvent[] = [];
    const traces: Array<{ event: string; details?: Record<string, unknown> }> =
      [];

    const coordinator = createVADCoordinator({
      vadFinalDebounceMs: 10,
      trace(event: string, details?: Record<string, unknown>) {
        traces.push({ event, details });
      },
      emitVADEvent(event: VADEvent) {
        listenerEvents.push(event);
        callbackEvents.push(event);
      },
      clearPendingFinalization() {},
      emitFinalTranscript() {},
    });

    const event = createEvent('speech_start');
    coordinator.handleVADEvent(event);

    expect(listenerEvents).toEqual([event]);
    expect(callbackEvents).toEqual([event]);
    expect(traces).toEqual([
      {
        event: 'vad.event',
        details: {
          type: 'speech_start',
          timestamp: 123,
          durationMs: 456,
        },
      },
    ]);
  });

  test('debounces finalization after speech_end', () => {
    const emitted: string[] = [];

    const coordinator = createVADCoordinator({
      vadFinalDebounceMs: 25,
      trace() {},
      emitVADEvent() {},
      clearPendingFinalization() {},
      emitFinalTranscript() {
        emitted.push('final');
      },
    });

    coordinator.handleVADEvent(createEvent('speech_end'));
    clock.tick(24);
    expect(emitted).toEqual([]);

    clock.tick(1);
    expect(emitted).toEqual(['final']);
  });

  test('cancels pending finalization when speech_start arrives', () => {
    const emitted: string[] = [];
    const clearCalls: number[] = [];

    const coordinator = createVADCoordinator({
      vadFinalDebounceMs: 25,
      trace() {},
      emitVADEvent() {},
      clearPendingFinalization() {
        clearCalls.push(Date.now());
      },
      emitFinalTranscript() {
        emitted.push('final');
      },
    });

    coordinator.handleVADEvent(createEvent('speech_end'));
    coordinator.handleVADEvent(createEvent('speech_start'));
    clock.tick(25);

    expect(clearCalls).toHaveLength(1);
    expect(emitted).toEqual([]);
  });

  test('destroy clears pending finalization timeout', () => {
    const emitted: string[] = [];

    const coordinator = createVADCoordinator({
      vadFinalDebounceMs: 25,
      trace() {},
      emitVADEvent() {},
      clearPendingFinalization() {},
      emitFinalTranscript() {
        emitted.push('final');
      },
    });

    coordinator.handleVADEvent(createEvent('utterance_end'));
    coordinator.destroy();
    clock.tick(25);

    expect(emitted).toEqual([]);
  });
});
