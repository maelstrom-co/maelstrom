import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeVoiceBenchmark } from './benchmark-metrics.ts';

const record = (
  assistantCapturedAudioActiveMs: number,
  repetition: number,
) => ({
  scenario: 'fixed-audio',
  repetition,
  assistantCapturedAudioActiveMs,
  captureOffsetStartMs: 0,
  captureOffsetEndMs: 0,
  measurements: {
    responseLatency: 'unsupported',
    bargeIn: 'unsupported',
    assistantTranscriptWordCount: 'unsupported',
    assistantSpeechWpm: 'unsupported',
  },
});

test('summarizes median and p95 for available captured-audio samples', () => {
  const summary = summarizeVoiceBenchmark([10, 30, 20].map(record));
  assert.equal(summary.sampleCount, 3);
  assert.deepEqual(summary.assistantCapturedAudioActiveMs, {
    median: 20,
    p95: 30,
  });
  assert.equal(summary.failures, 0);
  assert.match(summary.unsupported.responseLatency, /human VAD/);
});

test('averages the middle samples for an even-count median', () => {
  assert.equal(
    summarizeVoiceBenchmark([10, 30].map(record)).assistantCapturedAudioActiveMs
      .median,
    20,
  );
});

test('uses null percentiles for no samples', () => {
  assert.deepEqual(summarizeVoiceBenchmark([]).assistantCapturedAudioActiveMs, {
    median: null,
    p95: null,
  });
});
