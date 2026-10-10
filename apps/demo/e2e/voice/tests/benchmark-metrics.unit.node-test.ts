import assert from 'node:assert/strict';
import { test } from 'node:test';
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
