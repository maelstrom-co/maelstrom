import { describe, expect, test } from 'bun:test';

import {
  emitTelemetryEvent,
  noopTelemetrySink,
  recordTelemetryMetric,
  recordTelemetryTiming,
} from './sink.js';
import type {
  TelemetryAttributes,
  TelemetryEvent,
  TelemetryMetric,
  TelemetrySink,
  TelemetryTiming,
} from './types.js';

describe('noopTelemetrySink', () => {
  test('sink returns undefined from every method and does not throw', () => {
    const attributes: TelemetryAttributes = {
      'maelstrom.package': '@maelstrom-co/telemetry',
    };
    const event: TelemetryEvent = {
      name: 'maelstrom.test.event',
      attributes,
      severity: 'info',
      timestamp: 123,
    };
    const metric: TelemetryMetric = {
      name: 'maelstrom.test.metric',
      kind: 'counter',
      value: 1,
      unit: 'count',
      attributes,
      timestamp: 456,
    };
    const timing: TelemetryTiming = {
      name: 'maelstrom.test.timing',
      duration: 12,
      unit: 'ms',
      attributes,
      timestamp: 789,
    };

    expect(() => noopTelemetrySink.emitEvent(event)).not.toThrow();
    expect(() => noopTelemetrySink.recordMetric(metric)).not.toThrow();
    expect(() => noopTelemetrySink.recordTiming(timing)).not.toThrow();

    expect(noopTelemetrySink.emitEvent(event)).toBeUndefined();
    expect(noopTelemetrySink.recordMetric(metric)).toBeUndefined();
    expect(noopTelemetrySink.recordTiming(timing)).toBeUndefined();
  });
});

describe('telemetry sink helpers', () => {
  test('return undefined and stay inert when sink is omitted', () => {
    const event: TelemetryEvent = { name: 'maelstrom.test.event' };
    const metric: TelemetryMetric = {
      name: 'maelstrom.test.metric',
      kind: 'gauge',
      value: 2,
      unit: 'item',
    };
    const timing: TelemetryTiming = {
      name: 'maelstrom.test.timing',
      duration: 3,
      unit: 's',
    };

    expect(emitTelemetryEvent(undefined, event)).toBeUndefined();
    expect(recordTelemetryMetric(undefined, metric)).toBeUndefined();
    expect(recordTelemetryTiming(undefined, timing)).toBeUndefined();
  });

  test('sink emitTelemetryEvent calls only emitEvent once with original identity', () => {
    const counters = { emitEvent: 0, recordMetric: 0, recordTiming: 0 };
    const event: TelemetryEvent = {
      name: 'maelstrom.test.event',
      severity: 'warn',
    };

    const sink: TelemetrySink = {
      emitEvent(receivedEvent) {
        counters.emitEvent += 1;
        expect(receivedEvent).toBe(event);
      },
      recordMetric() {
        counters.recordMetric += 1;
      },
      recordTiming() {
        counters.recordTiming += 1;
      },
    };

    expect(emitTelemetryEvent(sink, event)).toBeUndefined();
    expect(counters).toEqual({ emitEvent: 1, recordMetric: 0, recordTiming: 0 });
  });

  test('sink recordTelemetryMetric calls only recordMetric once with original identity', () => {
    const counters = { emitEvent: 0, recordMetric: 0, recordTiming: 0 };
    const metric: TelemetryMetric = {
      name: 'maelstrom.test.metric',
      kind: 'histogram',
      unit: 'byte',
      value: 64,
    };

    const sink: TelemetrySink = {
      emitEvent() {
        counters.emitEvent += 1;
      },
      recordMetric(receivedMetric) {
        counters.recordMetric += 1;
        expect(receivedMetric).toBe(metric);
      },
      recordTiming() {
        counters.recordTiming += 1;
      },
    };

    expect(recordTelemetryMetric(sink, metric)).toBeUndefined();
    expect(counters).toEqual({ emitEvent: 0, recordMetric: 1, recordTiming: 0 });
  });

  test('sink recordTelemetryTiming calls only recordTiming once with original identity', () => {
    const counters = { emitEvent: 0, recordMetric: 0, recordTiming: 0 };
    const timing: TelemetryTiming = {
      name: 'maelstrom.test.timing',
      duration: 45,
      unit: 'ms',
    };

    const sink: TelemetrySink = {
      emitEvent() {
        counters.emitEvent += 1;
      },
      recordMetric() {
        counters.recordMetric += 1;
      },
      recordTiming(receivedTiming) {
        counters.recordTiming += 1;
        expect(receivedTiming).toBe(timing);
      },
    };

    expect(recordTelemetryTiming(sink, timing)).toBeUndefined();
    expect(counters).toEqual({ emitEvent: 0, recordMetric: 0, recordTiming: 1 });
  });
});
