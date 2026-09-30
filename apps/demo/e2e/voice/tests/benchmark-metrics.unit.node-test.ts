import { describe, expect, it } from 'vitest';
import { summarizeVoiceBenchmark } from './benchmark-metrics.ts';

describe('voice benchmark summary', () => {
  it('reports median and p95 for available captured-audio samples', () => {
    const summary = summarizeVoiceBenchmark(
      [10, 30, 20].map((assistantCapturedAudioActiveMs, repetition) => ({
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
      })),
    );
    expect(summary.sampleCount).toBe(3);
    expect(summary.assistantCapturedAudioActiveMs).toEqual({
      median: 20,
      p95: 30,
    });
    expect(summary.failures).toBe(0);
    expect(summary.unsupported.responseLatency).toContain('human VAD');
  });

  it('uses null percentiles for no samples', () => {
    expect(summarizeVoiceBenchmark([]).assistantCapturedAudioActiveMs).toEqual({
      median: null,
      p95: null,
    });
  });
});
