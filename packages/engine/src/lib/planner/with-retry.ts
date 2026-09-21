import { isErr } from '@maelstrom-co/protocol';

import { logAtSeverity } from '../severity-router.js';
import type { PlannerCandidate } from './candidate.js';
import type { Retryable, RetryFeedback, Stage } from './stage.js';

/** Retry budget for {@link withRetry}. */
export interface WithRetryOptions {
  /**
   * Maximum number of retries after the first attempt. Non-negative integer.
   * `0` still validates the candidate but never runs a second attempt.
   */
  readonly max: number;
}

/**
 * Re-runs `stage` while the Engine's validation recommends a retry, up to
 * `options.max` retries (`max + 1` attempts in total).
 *
 * Each candidate is checked with `ctx.validate`. A retry happens only when
 * the validation report sets `retryHint.recommend`; the retry receives the
 * original input plus {@link RetryFeedback} about the attempt just rejected
 * (never earlier ones). Every `Err`, from the stage or from validation, is
 * returned at once without using the budget. When the budget runs out, the
 * last candidate ships as-is: healing keeps it renderable.
 *
 * The signal is not checked between attempts; each attempt is responsible
 * for observing it.
 *
 * Logs `Retrying after recommended retry`, `Retry succeeded` and
 * `Retries exhausted` (the last only when `max > 0`), at a level derived from
 * the retry severity.
 *
 * @throws {Error} If `options.max` is not a non-negative integer.
 *
 * @example
 * ```ts
 * const planner = withRetry(llmPlanner({ adapter }), { max: 1 });
 * ```
 */
export function withRetry<In>(
  stage: Stage<Retryable<In>, PlannerCandidate>,
  options: WithRetryOptions,
): Stage<In, PlannerCandidate> {
  const maxRetries = options.max;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(
      `withRetry: max must be a non-negative integer, got ${maxRetries}`,
    );
  }
  return async (input, ctx) => {
    let attemptInput = input as Retryable<In>;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const result = await stage(attemptInput, ctx);
      if (isErr(result)) return result;

      const report = ctx.validate(result.value);
      if (isErr(report)) return report;

      const { diagnostics } = report.value;
      const { retryHint } = diagnostics;
      if (!retryHint.recommend) {
        if (attempt > 0) {
          ctx.logger.info('Retry succeeded', { attempt, maxRetries });
        }
        return result;
      }

      if (attempt === maxRetries) {
        if (maxRetries > 0) {
          logAtSeverity(ctx.logger, retryHint.severity, 'Retries exhausted', {
            attempts: attempt + 1,
            retrySeverity: retryHint.severity,
            droppedLayoutCount: diagnostics.counts.droppedLayoutEntries,
            skippedActionCount: diagnostics.counts.skippedActions,
            warningCount: diagnostics.counts.warnings,
          });
        }
        return result;
      }

      const retry: RetryFeedback = {
        attempt: attempt + 1,
        previous: result.value,
        diagnostics,
      };
      attemptInput = { ...input, retry };
      logAtSeverity(
        ctx.logger,
        retryHint.severity,
        'Retrying after recommended retry',
        {
          attempt: attempt + 1,
          maxRetries,
          retrySeverity: retryHint.severity,
          droppedLayoutCount: diagnostics.counts.droppedLayoutEntries,
          skippedActionCount: diagnostics.counts.skippedActions,
          warningCount: diagnostics.counts.warnings,
        },
      );
    }

    throw new Error(
      `withRetry invariant violation: loop exited without returning (max=${maxRetries})`,
    );
  };
}
