import type { Result } from '@maelstrom-co/protocol';
import type { OperationalOutcome } from '@maelstrom-co/telemetry/integration';
import type { StageError } from './planner/stage.js';

const unexpectedFailures = new WeakSet<object>();

export function markUnexpectedFailure<Failure extends object>(
  failure: Failure,
): Failure {
  unexpectedFailures.add(failure);
  return failure;
}

export const validationFailure = {
  outcome: 'failed',
  errorCategory: 'validation',
} satisfies OperationalOutcome;

export function thrownOutcome(signal?: AbortSignal): OperationalOutcome {
  return signal?.aborted
    ? { outcome: 'cancelled' }
    : { outcome: 'failed', errorCategory: 'unknown' };
}

export function operationalOutcome(
  result: Result<unknown, StageError>,
): OperationalOutcome {
  try {
    if (result.ok) return { outcome: 'succeeded' };
    if (unexpectedFailures.has(result.error))
      return { outcome: 'failed', errorCategory: 'unknown' };
    switch (result.error._tag) {
      case 'CancellationError':
        return { outcome: 'cancelled' };
      case 'Deferred':
        return { outcome: 'skipped' };
      case 'ProviderError':
        return { outcome: 'failed', errorCategory: 'provider' };
      case 'TimeoutError':
        return { outcome: 'failed', errorCategory: 'timeout' };
      case 'ParseError':
      case 'ValidationError':
      case 'RequestValidationError':
        return { outcome: 'failed', errorCategory: 'validation' };
      case 'HistoryError':
        return { outcome: 'failed', errorCategory: 'application' };
      default:
        void (result.error satisfies never);
        return { outcome: 'failed', errorCategory: 'unknown' };
    }
  } catch {
    // Untyped results can contain throwing getters; observation must remain optional.
    return { outcome: 'unknown' };
  }
}
