import { describe, expect, test } from 'bun:test';
import type { TelemetrySink } from '@maelstrom-co/telemetry';
import {
  emitVoiceSessionTelemetryEvent,
  recordVoiceSessionTelemetryMetric,
  recordVoiceSessionTelemetryTiming,
} from './telemetry.js';

describe('voice-server telemetry helpers', () => {
  test('no-op when sink is undefined', () => {
    expect(
      emitVoiceSessionTelemetryEvent(undefined, {
        name: 'maelstrom.voice_server.event',
      }),
    ).toBeUndefined();

    expect(
      recordVoiceSessionTelemetryMetric(undefined, {
        name: 'maelstrom.voice_server.metric',
        value: 3,
      }),
    ).toBeUndefined();

    expect(
      recordVoiceSessionTelemetryTiming(undefined, {
        name: 'maelstrom.voice_server.timing',
        duration: 12,
      }),
    ).toBeUndefined();
  });

  test('swallows sink throws for every emission kind', () => {
    const throwingSink: TelemetrySink = {
      emitEvent() {
        throw new Error('event boom');
      },
      recordMetric() {
        throw new Error('metric boom');
      },
      recordTiming() {
        throw new Error('timing boom');
      },
    };

    expect(
      emitVoiceSessionTelemetryEvent(throwingSink, {
        name: 'maelstrom.voice_server.event',
      }),
    ).toBeUndefined();

    expect(
      recordVoiceSessionTelemetryMetric(throwingSink, {
        name: 'maelstrom.voice_server.metric',
        value: 1,
      }),
    ).toBeUndefined();

    expect(
      recordVoiceSessionTelemetryTiming(throwingSink, {
        name: 'maelstrom.voice_server.timing',
        duration: 10,
      }),
    ).toBeUndefined();
  });

  test('records metrics with count units', () => {
    const recordedMetrics: unknown[] = [];
    const sink: TelemetrySink = {
      emitEvent() {},
      recordMetric(metric) {
        recordedMetrics.push(metric);
      },
      recordTiming() {},
    };

    recordVoiceSessionTelemetryMetric(sink, {
      name: 'maelstrom.voice_server.metric',
      value: 7,
      timestamp: 123,
      attributes: { outcome: 'ok' },
    });

    expect(recordedMetrics).toEqual([
      {
        name: 'maelstrom.voice_server.metric',
        kind: 'counter',
        value: 7,
        unit: 'count',
        timestamp: 123,
        attributes: { outcome: 'ok' },
      },
    ]);
  });

  test('records timings with millisecond units', () => {
    const recordedTimings: unknown[] = [];
    const sink: TelemetrySink = {
      emitEvent() {},
      recordMetric() {},
      recordTiming(timing) {
        recordedTimings.push(timing);
      },
    };

    recordVoiceSessionTelemetryTiming(sink, {
      name: 'maelstrom.voice_server.timing',
      duration: 42,
      timestamp: 456,
      attributes: { outcome: 'ok' },
    });

    expect(recordedTimings).toEqual([
      {
        name: 'maelstrom.voice_server.timing',
        duration: 42,
        unit: 'ms',
        timestamp: 456,
        attributes: { outcome: 'ok' },
      },
    ]);
  });
});
