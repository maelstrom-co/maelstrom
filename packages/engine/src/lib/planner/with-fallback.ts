import { isOk } from '@maelstrom-co/protocol';

import type { Stage } from './stage.js';
import { isDeferred } from './stage.js';

/**
 * Runs `primary`, and runs `fallback` with the same input and context only
 * when `primary` returns a `Deferred`. Candidates and `EngineError`s from
 * `primary` are returned unchanged, so a real failure is never masked by a
 * second attempt.
 *
 * The two run one after the other: on deferral the latencies add up. Both
 * stages share the request's signal and must honour it.
 *
 * @example
 * ```ts
 * const planner = withFallback(
 *   pipeline(selectVessels, arrangeLayout),
 *   llmPlanner({ adapter }),
 * );
 * ```
 */
export function withFallback<In, Out>(
  primary: Stage<In, Out>,
  fallback: Stage<In, Out>,
): Stage<In, Out> {
  return async (input, ctx) => {
    const result = await primary(input, ctx);
    if (isOk(result) || !isDeferred(result.error)) return result;
    ctx.logger.info('Planner stage deferred, running fallback', {
      messageId: ctx.origin.messageId,
      reason: result.error.reason,
    });
    return fallback(input, ctx);
  };
}
