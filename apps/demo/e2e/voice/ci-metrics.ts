export type VoiceCiMetric = {
  readonly p95Ms: number;
  readonly samples: number;
};
export type VoiceCiMetrics = {
  readonly schemaVersion: 1;
  readonly status: 'passed';
  readonly assistant: VoiceCiMetric;
  readonly taskBargeIn: VoiceCiMetric;
  readonly greetingBargeIn: VoiceCiMetric;
};

export const voiceReportNames = {
  'voice-benchmark.json': 'assistant',
  'voice-barge-in-benchmark.json': 'taskBargeIn',
  'voice-greeting-barge-in-benchmark.json': 'greetingBargeIn',
} as const;

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid metric object');
  return value as Record<string, unknown>;
};

const positiveCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function readCiMetric(value: unknown): VoiceCiMetric {
  const metric = object(value);
  if (
    Object.keys(metric).some((key) => key !== 'p95Ms' && key !== 'samples') ||
    typeof metric.p95Ms !== 'number' ||
    !Number.isFinite(metric.p95Ms) ||
    metric.p95Ms < 0 ||
    metric.p95Ms > 600_000 ||
    !positiveCount(metric.samples)
  )
    throw new Error('Invalid p95 metric');
  return { p95Ms: metric.p95Ms, samples: metric.samples };
}

export function extractCiMetric(
  name: keyof typeof voiceReportNames,
  value: unknown,
): VoiceCiMetric {
  const report = object(value);
  const summary = object(report.summary);
  if (summary.failures !== 0) throw new Error('Benchmark has failures');
  if (name === 'voice-benchmark.json') {
    if (
      report.benchmark !== 'playwright-voice' ||
      report.mode !== 'full-scenario-suite' ||
      object(report.responseLatency).status !== 'measured'
    )
      throw new Error('Response latency was not fully measured');
    const metric = object(summary.responseLatencyMs);
    return readCiMetric({ p95Ms: metric.p95, samples: metric.sampleCount });
  }
  const expected =
    name === 'voice-barge-in-benchmark.json'
      ? 'playwright-voice-barge-in'
      : 'playwright-voice-greeting-barge-in';
  const validation = object(report.validation);
  const barge = object(summary.bargeIn);
  const counts = object(barge.counts);
  const metric = object(barge.latencyMs);
  if (
    report.benchmark !== expected ||
    report.status !== 'passed' ||
    validation.status !== 'passed' ||
    validation.failedAttemptCount !== 0 ||
    !positiveCount(validation.expectedAttemptCount) ||
    validation.attemptCount !== validation.expectedAttemptCount ||
    counts.measured !== validation.expectedAttemptCount ||
    ['invalid', 'ambiguous', 'timeout', 'failed'].some(
      (key) => counts[key] !== 0,
    ) ||
    metric.sampleCount !== validation.expectedAttemptCount
  )
    throw new Error('Barge-in attempts were not fully measured');
  return readCiMetric({ p95Ms: metric.p95, samples: metric.sampleCount });
}

export function readCiMetrics(value: unknown): VoiceCiMetrics {
  const report = object(value);
  if (
    report.schemaVersion !== 1 ||
    report.status !== 'passed' ||
    Object.keys(report).some(
      (key) =>
        ![
          'schemaVersion',
          'status',
          'assistant',
          'taskBargeIn',
          'greetingBargeIn',
        ].includes(key),
    )
  )
    throw new Error('Invalid CI metrics envelope');
  return {
    schemaVersion: 1,
    status: 'passed',
    assistant: readCiMetric(report.assistant),
    taskBargeIn: readCiMetric(report.taskBargeIn),
    greetingBargeIn: readCiMetric(report.greetingBargeIn),
  };
}
