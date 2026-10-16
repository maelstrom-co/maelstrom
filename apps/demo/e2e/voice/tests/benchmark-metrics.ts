import {
  type BargeInMeasurement,
  summarizeBargeIn,
} from './barge-in-measurement.ts';
import type { AudioTimelineMeasurement } from './shared-audio-timeline.ts';

export type VoiceBenchmarkRecord = {
  readonly scenario: string;
  readonly repetition: number;
  readonly fixture?: {
    readonly sampleRate: number;
    readonly channels: number;
    readonly frameCount: number;
    readonly durationMs: number;
  };
  readonly playback?: {
    readonly status: 'completed';
    readonly elapsedMs: number;
    readonly workletStartFrame: number;
    readonly workletEndFrame: number;
  };
  readonly assistantCapturedAudioActiveMs: number;
  readonly measurements: {
    readonly bargeIn: 'unsupported' | BargeInMeasurement;
    readonly assistantTranscriptWordCount: 'unsupported';
    readonly assistantSpeechWpm: 'unsupported';
  };
};

export function summarizeVoiceBenchmark(
  records: readonly VoiceBenchmarkRecord[],
  responseLatency: AudioTimelineMeasurement,
  failures = 0,
) {
  const activeAudio = records
    .map((record) => record.assistantCapturedAudioActiveMs)
    .sort((a, b) => a - b);
  const latencyValues = responseLatency.turns
    .filter((turn) => turn.status === 'measured')
    .map((turn) => turn.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const bargeIn = summarizeBargeIn(
    records.flatMap((record) =>
      record.measurements.bargeIn === 'unsupported'
        ? []
        : [record.measurements.bargeIn],
    ),
  );
  const percentile = (values: readonly number[], rank: number) =>
    values.length === 0 ? null : values[Math.ceil(rank * values.length) - 1];
  const median = (values: readonly number[]) => {
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    const center = values[middle];
    if (center === undefined) return null;
    if (values.length % 2 !== 0) return center;
    const lower = values[middle - 1];
    return lower === undefined ? null : (lower + center) / 2;
  };
  return {
    sampleCount: records.length,
    failures,
    assistantCapturedAudioActiveMs: {
      median: median(activeAudio),
      p95: percentile(activeAudio, 0.95),
    },
    responseLatencyMs: {
      sampleCount: latencyValues.length,
      median: median(latencyValues),
      p95: percentile(latencyValues, 0.95),
    },
    bargeIn,
    unsupported: {
      responseLatency:
        responseLatency.status === 'measured'
          ? null
          : responseLatency.turns
              .filter((turn) => turn.status === 'unsupported')
              .map((turn) => turn.reason)
              .filter((reason): reason is string => reason !== undefined)
              .join('; ') ||
            responseLatency.reason ||
            'Some or all human turns were unsupported.',
      bargeIn:
        bargeIn.latencyMs.sampleCount > 0
          ? null
          : 'No corroborated barge-in stops were measured in this benchmark lane.',
      assistantTranscriptWordCount:
        'Unavailable: UI captions are not a reliable transcript measurement API.',
      assistantSpeechWpm:
        'Unavailable: reliable transcript word count and timestamped speech duration are unavailable.',
    },
  };
}
