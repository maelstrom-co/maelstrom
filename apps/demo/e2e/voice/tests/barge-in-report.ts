import type { BargeInMeasurement } from './barge-in-measurement.ts';

export type BargeInRunAssessment = {
  readonly status: 'passed' | 'failed';
  readonly expectedAttemptCount: number;
  readonly attemptCount: number;
  readonly failedAttemptCount: number;
  readonly reasons: readonly string[];
};

export function assessBargeInRun(
  measurements: readonly BargeInMeasurement[],
  expectedAttemptCount: number,
): BargeInRunAssessment {
  const reasons: string[] = [];
  if (!Number.isSafeInteger(expectedAttemptCount) || expectedAttemptCount < 1)
    reasons.push('Expected attempt count must be a positive integer.');
  const missing =
    Number.isSafeInteger(expectedAttemptCount) && expectedAttemptCount > 0
      ? Math.max(0, expectedAttemptCount - measurements.length)
      : 0;
  if (measurements.length !== expectedAttemptCount)
    reasons.push(
      `Expected ${expectedAttemptCount} attempts, observed ${measurements.length}.`,
    );
  let failedAttemptCount = missing;
  for (const [index, measurement] of measurements.entries()) {
    if (
      measurement.status === 'measured' &&
      measurement.latencyMs !== null &&
      Number.isFinite(measurement.latencyMs) &&
      measurement.latencyMs >= 0
    )
      continue;
    failedAttemptCount++;
    reasons.push(
      `Attempt ${index + 1}: ${measurement.status} — ${measurement.reason ?? 'No usable latency value.'}`,
    );
  }
  return {
    status: reasons.length === 0 ? 'passed' : 'failed',
    expectedAttemptCount,
    attemptCount: measurements.length,
    failedAttemptCount,
    reasons,
  };
}

export async function completeBargeInReport<T>(
  report: T,
  assessment: BargeInRunAssessment,
  attach: (report: T) => Promise<unknown>,
  infrastructureError?: unknown,
): Promise<void> {
  await attach(report);
  if (infrastructureError !== undefined) throw infrastructureError;
  if (assessment.status !== 'passed')
    throw new Error(
      `Barge-in benchmark has non-measured attempts. ${assessment.reasons.join(' ')}`,
    );
}
