export type VoiceBenchmarkRecord = {
  readonly scenario: string;
  readonly repetition: number;
  readonly assistantCapturedAudioActiveMs: number;
  readonly measurements: {
    readonly responseLatency: string;
    readonly bargeIn: string;
    readonly assistantTranscriptWordCount: string;
    readonly assistantSpeechWpm: string;
  };
};

export function summarizeVoiceBenchmark(
  records: readonly VoiceBenchmarkRecord[],
  failures = 0,
) {
  const values = records
    .map((record) => record.assistantCapturedAudioActiveMs)
    .sort((a, b) => a - b);
  const percentile = (rank: number) =>
    values.length === 0 ? null : values[Math.ceil(rank * values.length) - 1];
  const middle = Math.floor(values.length / 2);
  const lowerMiddle = values[middle - (values.length % 2 === 0 ? 1 : 0)];
  const upperMiddle = values[middle];
  const median =
    lowerMiddle === undefined || upperMiddle === undefined
      ? null
      : (lowerMiddle + upperMiddle) / 2;
  return {
    sampleCount: records.length,
    failures,
    assistantCapturedAudioActiveMs: {
      median,
      p95: percentile(0.95),
    },
    unsupported: {
      responseLatency:
        'Unavailable: human VAD segment end timestamps are not exposed to Playwright.',
      bargeIn:
        'Unavailable: timestamped human interruption and assistant audio-stop boundaries are not exposed to Playwright.',
      assistantTranscriptWordCount:
        'Unavailable: UI captions are not a reliable transcript measurement API.',
      assistantSpeechWpm:
        'Unavailable: reliable transcript word count and timestamped speech duration are unavailable.',
    },
  };
}
