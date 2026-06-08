import { describe, expect, test } from 'bun:test';

import {
  isMaelstromTelemetryAttribute,
  isMaelstromTelemetryMetric,
  isMaelstromTelemetryName,
  maelstromTelemetryAttributes,
  maelstromTelemetryEvents,
  maelstromTelemetryMetrics,
} from './vocabulary.js';

const metricUnitSuffixPattern = /(?:_ms|_bytes|\.ms|\.bytes)$/;
const allCuratedEntries = [
  ...Object.entries(maelstromTelemetryAttributes),
  ...Object.entries(maelstromTelemetryEvents),
  ...Object.entries(maelstromTelemetryMetrics),
] as const;

describe('maelstrom telemetry vocabulary', () => {
  test('every curated name uses the maelstrom namespace and never otel', () => {
    for (const [key, entry] of allCuratedEntries) {
      expect(key).toBe(entry.name);
      expect(entry.name.startsWith('maelstrom.')).toBe(true);
      expect(entry.name.startsWith('otel.')).toBe(false);
    }
  });

  test('metric names stay unit-free and metric entries include unit metadata', () => {
    for (const [key, entry] of Object.entries(maelstromTelemetryMetrics)) {
      expect(key).toBe(entry.name);
      expect(metricUnitSuffixPattern.test(entry.name)).toBe(false);
      expect(entry.unit).toBeDefined();
      expect(typeof entry.unit).toBe('string');
      expect(entry.kind).toBeDefined();
      expect(typeof entry.kind).toBe('string');
    }
  });

  test('curated attributes include privacy classification and default eligibility metadata', () => {
    for (const [key, entry] of Object.entries(maelstromTelemetryAttributes)) {
      expect(key).toBe(entry.name);
      expect(entry.privacy.classification).toMatch(
        /^(safe|low_cardinality|sensitive|unsafe_by_default)$/,
      );
      expect(typeof entry.privacy.defaultAllowed).toBe('boolean');
      expect(entry.privacy.reason.length).toBeGreaterThan(0);
    }
  });

  test('helper predicates recognize only curated names in their supported categories', () => {
    for (const name of Object.keys(maelstromTelemetryAttributes)) {
      expect(isMaelstromTelemetryName(name)).toBe(true);
      expect(isMaelstromTelemetryAttribute(name)).toBe(true);
      expect(isMaelstromTelemetryMetric(name)).toBe(false);
    }

    for (const name of Object.keys(maelstromTelemetryMetrics)) {
      expect(isMaelstromTelemetryName(name)).toBe(true);
      expect(isMaelstromTelemetryAttribute(name)).toBe(false);
      expect(isMaelstromTelemetryMetric(name)).toBe(true);
    }

    for (const name of Object.keys(maelstromTelemetryEvents)) {
      expect(isMaelstromTelemetryName(name)).toBe(true);
      expect(isMaelstromTelemetryAttribute(name)).toBe(false);
      expect(isMaelstromTelemetryMetric(name)).toBe(false);
    }

    expect(isMaelstromTelemetryName('otel.operation.duration')).toBe(false);
    expect(isMaelstromTelemetryName('maelstrom.unknown')).toBe(false);
    expect(isMaelstromTelemetryAttribute('maelstrom.telemetry.event')).toBe(false);
    expect(isMaelstromTelemetryMetric('maelstrom.layout_mode')).toBe(false);
  });
});
