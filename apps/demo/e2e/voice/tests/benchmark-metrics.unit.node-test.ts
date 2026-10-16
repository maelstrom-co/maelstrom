import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BargeInMeasurement,
  invalidBargeIn,
} from './barge-in-measurement.ts';
import {
  summarizeVoiceBenchmark,
  type VoiceBenchmarkRecord,
} from './benchmark-metrics.ts';

const record = (assistantCapturedAudioActiveMs: number, repetition: number) =>
  ({
    scenario: 'fixed-audio',
    repetition,
    assistantCapturedAudioActiveMs,
    measurements: {
      bargeIn: 'unsupported',
      assistantTranscriptWordCount: 'unsupported',
      assistantSpeechWpm: 'unsupported',
    },
  }) satisfies VoiceBenchmarkRecord;

const unsupportedLatency = {
  status: 'unsupported' as const,
  t0Sample: null,
  turns: [],
  reason: 'No human VAD segments were detected.',
};

test('summarizes median and p95 for available captured-audio samples', () => {
  const summary = summarizeVoiceBenchmark(
    [10, 30, 20].map(record),
    unsupportedLatency,
  );
  assert.equal(summary.sampleCount, 3);
  assert.deepEqual(summary.assistantCapturedAudioActiveMs, {
    median: 20,
    p95: 30,
  });
  assert.equal(summary.failures, 0);
  assert.ok(summary.unsupported.responseLatency);
  assert.match(summary.unsupported.responseLatency, /human VAD/);
});

test('averages the middle samples for an even-count median', () => {
  assert.equal(
    summarizeVoiceBenchmark([10, 30].map(record), unsupportedLatency)
      .assistantCapturedAudioActiveMs.median,
    20,
  );
});

test('summarizes barge-in attempts without changing legacy audio metrics', () => {
  const measured = {
    status: 'measured' as const,
    humanOnsetSample: 800,
    assistantStopSample: 1_000,
    latencyMs: 200,
    reason: null,
  } satisfies BargeInMeasurement;
  const records: VoiceBenchmarkRecord[] = [
    record(10, 1),
    {
      ...record(20, 2),
      measurements: { ...record(20, 2).measurements, bargeIn: measured },
    },
    {
      ...record(30, 3),
      measurements: {
        ...record(30, 3).measurements,
        bargeIn: invalidBargeIn('missing samples'),
      },
    },
  ];
  const summary = summarizeVoiceBenchmark(records, unsupportedLatency);
  assert.equal(summary.bargeIn.attemptCount, 2);
  assert.equal(summary.bargeIn.latencyMs.median, 200);
  assert.equal(summary.bargeIn.counts.invalid, 1);
  assert.equal(summary.unsupported.bargeIn, null);
  assert.equal(summary.assistantCapturedAudioActiveMs.median, 20);
});

test('uses null percentiles for no samples', () => {
  assert.deepEqual(
    summarizeVoiceBenchmark([], unsupportedLatency)
      .assistantCapturedAudioActiveMs,
    {
      median: null,
      p95: null,
    },
  );
});
