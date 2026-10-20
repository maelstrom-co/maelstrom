export type VoiceCiMetric = {
  readonly p95Ms: number;
  readonly samples: number;
};
export type VoiceCiProvenance = {
  readonly targetSha: string;
  readonly runId: string;
  readonly runAttempt: string;
};

export const voiceReportNames = {
  'voice-benchmark.json': 'assistant',
  'voice-barge-in-benchmark.json': 'taskBargeIn',
  'voice-greeting-barge-in-benchmark.json': 'greetingBargeIn',
} as const;
export type VoiceReportName = keyof typeof voiceReportNames;
export const voiceRejectionReasons = [
  'missing-report',
  'duplicate-report',
  'test-failed',
  'test-retried',
  'invalid-content-type',
  'unsafe-attachment',
  'attachment-missing',
  'attachment-too-large',
  'invalid-json',
  'invalid-report',
  'benchmark-failed',
  'count-mismatch',
  'unmeasured-lane',
  'invalid-metric',
] as const;
export type VoiceRejectionReason = (typeof voiceRejectionReasons)[number];
export type VoiceCiLane =
  | ({ readonly status: 'validated' } & VoiceCiMetric)
  | { readonly status: 'unavailable'; readonly reason: VoiceRejectionReason };
export type VoiceCiMetrics = {
  readonly schemaVersion: 2;
  readonly status: 'passed' | 'failed';
  readonly provenance: VoiceCiProvenance;
  readonly assistant: VoiceCiLane;
  readonly taskBargeIn: VoiceCiLane;
  readonly greetingBargeIn: VoiceCiLane;
};

export class VoiceMetricRejection extends Error {
  constructor(readonly reason: VoiceRejectionReason) {
    super(reason);
  }
}
const reject = (reason: VoiceRejectionReason): never => {
  throw new VoiceMetricRejection(reason);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return reject('invalid-report');
  return value as Record<string, unknown>;
};
const positiveCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const latency = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 600_000;

export function readCiProvenance(value: unknown): VoiceCiProvenance {
  const record = object(value);
  if (
    Object.keys(record).length !== 3 ||
    typeof record.targetSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(record.targetSha) ||
    typeof record.runId !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(record.runId) ||
    typeof record.runAttempt !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(record.runAttempt)
  )
    throw new Error('Invalid CI metrics provenance');
  return {
    targetSha: record.targetSha,
    runId: record.runId,
    runAttempt: record.runAttempt,
  };
}

export function readCiMetric(value: unknown): VoiceCiMetric {
  const metric = object(value);
  if (
    Object.keys(metric).some((key) => key !== 'p95Ms' && key !== 'samples') ||
    !latency(metric.p95Ms) ||
    !positiveCount(metric.samples)
  )
    return reject('invalid-metric');
  return { p95Ms: metric.p95Ms, samples: metric.samples };
}

export function extractCiMetric(
  name: VoiceReportName,
  value: unknown,
): VoiceCiMetric {
  const report = object(value);
  const summary = object(report.summary);
  if (
    summary.failures !== 0 ||
    (report.status !== undefined && report.status !== 'passed')
  )
    return reject('benchmark-failed');
  if (name === 'voice-benchmark.json') {
    const response = object(report.responseLatency);
    if (
      report.benchmark !== 'playwright-voice' ||
      report.mode !== 'full-scenario-suite'
    )
      return reject('invalid-report');
    if (response.status !== 'measured') return reject('unmeasured-lane');
    const metric = object(summary.responseLatencyMs);
    if (
      !Array.isArray(response.turns) ||
      !positiveCount(metric.sampleCount) ||
      response.turns.length !== metric.sampleCount
    )
      return reject('count-mismatch');
    if (
      response.turns.some(
        (turn) =>
          object(turn).status !== 'measured' ||
          !latency(object(turn).latencyMs),
      )
    )
      return reject('unmeasured-lane');
    return readCiMetric({ p95Ms: metric.p95, samples: metric.sampleCount });
  }
  const expected =
    name === 'voice-barge-in-benchmark.json'
      ? 'playwright-voice-barge-in'
      : 'playwright-voice-greeting-barge-in';
  if (report.benchmark !== expected) return reject('invalid-report');
  const validation = object(report.validation);
  const barge = object(summary.bargeIn);
  const counts = object(barge.counts);
  const metric = object(barge.latencyMs);
  if (
    report.status !== 'passed' ||
    validation.status !== 'passed' ||
    validation.failedAttemptCount !== 0 ||
    ['invalid', 'ambiguous', 'timeout', 'failed'].some(
      (key) => counts[key] !== 0,
    )
  )
    return reject('benchmark-failed');
  if (
    !positiveCount(validation.expectedAttemptCount) ||
    validation.attemptCount !== validation.expectedAttemptCount ||
    barge.attemptCount !== validation.expectedAttemptCount ||
    barge.validAttemptCount !== validation.expectedAttemptCount ||
    counts.measured !== validation.expectedAttemptCount ||
    metric.sampleCount !== validation.expectedAttemptCount ||
    !Array.isArray(report.attempts) ||
    report.attempts.length !== validation.expectedAttemptCount
  )
    return reject('count-mismatch');
  if (
    report.attempts.some((attempt) => {
      const measurement = object(object(attempt).measurement);
      return (
        measurement.status !== 'measured' || !latency(measurement.latencyMs)
      );
    })
  )
    return reject('unmeasured-lane');
  return readCiMetric({ p95Ms: metric.p95, samples: metric.sampleCount });
}

function readCiLane(value: unknown): VoiceCiLane {
  const lane = object(value);
  if (lane.status === 'validated' && Object.keys(lane).length === 3)
    return {
      status: 'validated',
      ...readCiMetric({ p95Ms: lane.p95Ms, samples: lane.samples }),
    };
  if (
    lane.status === 'unavailable' &&
    Object.keys(lane).length === 2 &&
    voiceRejectionReasons.some((reason) => reason === lane.reason)
  )
    return {
      status: 'unavailable',
      reason: lane.reason as VoiceRejectionReason,
    };
  throw new Error('Invalid CI lane outcome');
}

export function readCiMetrics(
  value: unknown,
  expected: VoiceCiProvenance,
): VoiceCiMetrics {
  const report = object(value);
  if (
    report.schemaVersion !== 2 ||
    !['passed', 'failed'].includes(String(report.status)) ||
    typeof report.status !== 'string' ||
    Object.keys(report).length !== 6
  )
    throw new Error('Invalid CI metrics envelope');
  const provenance = readCiProvenance(report.provenance);
  const current = readCiProvenance(expected);
  if (
    provenance.targetSha !== current.targetSha ||
    provenance.runId !== current.runId ||
    provenance.runAttempt !== current.runAttempt
  )
    throw new Error('CI metrics provenance mismatch');
  const lanes = {
    assistant: readCiLane(report.assistant),
    taskBargeIn: readCiLane(report.taskBargeIn),
    greetingBargeIn: readCiLane(report.greetingBargeIn),
  };
  if (
    report.status === 'passed' &&
    Object.values(lanes).some((lane) => lane.status !== 'validated')
  )
    throw new Error('Passed CI metrics require every lane');
  return {
    schemaVersion: 2,
    status: report.status as 'passed' | 'failed',
    provenance,
    ...lanes,
  };
}
