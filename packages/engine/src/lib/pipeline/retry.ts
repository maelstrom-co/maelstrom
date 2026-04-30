import type { Result } from '@maelstrom-co/protocol';
import { isErr, ok } from '@maelstrom-co/protocol';

import type { EngineError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { InternalResponse } from '../response/response-processor.js';
import { logAtSeverity } from '../severity-router.js';

import { buildRetryPrompt } from './retry-prompt.js';

export type RunOnce = (
  userPrompt: string,
  signal?: AbortSignal,
) => Promise<Result<InternalResponse, EngineError>>;

export interface CallWithRetryConfig {
  readonly runOnce: RunOnce;
  readonly originalUserPrompt: string;
  readonly maxRetries: number;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
}

/**
 * Run `runOnce` up to `maxRetries + 1` times, re-prompting only when heal
 * recommends a retry (`diagnostics.retryHint.recommend === true`).
 *
 * - `Err` returns are fatal — surfaced immediately without consuming a
 *   retry. Provider / cancellation / timeout / parse / history failures
 *   are not heal-recoverable; another LLM call will not fix them.
 * - On budget exhaustion the final attempt's response ships as-is. Heal
 *   guarantees it is renderable; the user sees a degraded but valid UI
 *   rather than an error.
 *
 * `maxRetries === 0` keeps the layer wired (logs + predicate evaluation)
 * but never fires a second attempt — useful for deterministic harnesses
 * and consumers that own their own retry policy.
 */
export async function callWithRetry(
  config: CallWithRetryConfig,
): Promise<Result<InternalResponse, EngineError>> {
  const { runOnce, originalUserPrompt, maxRetries, logger, signal } = config;

  let userPrompt = originalUserPrompt;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await runOnce(userPrompt, signal);
    if (isErr(result)) {
      return result;
    }

    const lastResponse = result.value;
    const { retryHint } = lastResponse.diagnostics;
    if (!retryHint.recommend) {
      if (attempt > 0) {
        logger.info('Retry succeeded', { attempt, maxRetries });
      }
      return ok(lastResponse);
    }

    if (attempt === maxRetries) {
      // Out of budget. Heal guarantees the response is renderable; the user
      // sees a degraded UI rather than an error. The summary log line is the
      // only signal an operator gets, so emit it whenever a retry was even
      // possible (maxRetries > 0). Severity drives the level so headline
      // failures cross default `warn`-threshold paging filters.
      if (maxRetries > 0) {
        logAtSeverity(logger, retryHint.severity, 'Retries exhausted', {
          attempts: attempt + 1,
          retrySeverity: retryHint.severity,
          droppedLayoutCount: lastResponse.diagnostics.droppedLayoutEntries.length,
          skippedActionCount: lastResponse.diagnostics.skippedActions.length,
          warningCount: lastResponse.diagnostics.warnings.length,
        });
      }
      return ok(lastResponse);
    }

    userPrompt = buildRetryPrompt(originalUserPrompt, lastResponse.diagnostics);
    logAtSeverity(
      logger,
      retryHint.severity,
      'Retrying after recommended retry',
      {
        attempt: attempt + 1,
        maxRetries,
        retrySeverity: retryHint.severity,
        droppedLayoutCount: lastResponse.diagnostics.droppedLayoutEntries.length,
        skippedActionCount: lastResponse.diagnostics.skippedActions.length,
        warningCount: lastResponse.diagnostics.warnings.length,
      },
    );
  }

  // Unreachable when `maxRetries >= 0` (the documented contract): the
  // for-loop runs at least once and every iteration either returns or
  // continues. Falling through is an invariant breach — fail loudly.
  throw new Error(
    `callWithRetry invariant violation: loop exited without returning (maxRetries=${maxRetries})`,
  );
}

export { buildRetryPrompt };
