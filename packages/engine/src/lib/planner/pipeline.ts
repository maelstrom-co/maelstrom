import type { Result } from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';

import { cancellationError } from '../errors.js';
import type { PlannerCandidate } from './candidate.js';
import { stageName } from './instrument.js';
import type { Planner, PlanningInput, Stage, StageError } from './stage.js';

/**
 * Composes stages into a {@link Planner}, feeding each stage's output to the
 * next. The first stage takes {@link PlanningInput}, the last produces a
 * {@link PlannerCandidate}, and every adjacent pair must agree on the type in
 * between; a mismatch is a compile error at the offending argument.
 *
 * Every stage receives the same {@link StageContext}, and runs wrapped by
 * its {@link StageContext.instrument}: once per request, just before it
 * runs, under the name given with {@link named} or `stage-<index>`. The
 * first `Err`
 * (a `Deferred` or an `EngineError`) stops the pipeline and is returned
 * unchanged. If the request's signal aborts while a stage is running, the
 * next stage does not start and the pipeline returns a `CancellationError`.
 *
 * Accepts one to nine stages.
 *
 * @example
 * ```ts
 * const planner = pipeline(selectVessels, arrangeLayout);
 * ```
 */
export function pipeline(s1: Planner): Planner;
export function pipeline<A>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, PlannerCandidate>,
): Planner;
export function pipeline<A, B>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, PlannerCandidate>,
): Planner;
export function pipeline<A, B, C>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, PlannerCandidate>,
): Planner;
export function pipeline<A, B, C, D>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, PlannerCandidate>,
): Planner;
export function pipeline<A, B, C, D, E>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, PlannerCandidate>,
): Planner;
export function pipeline<A, B, C, D, E, F>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, F>,
  s7: Stage<F, PlannerCandidate>,
): Planner;
export function pipeline<A, B, C, D, E, F, G>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, F>,
  s7: Stage<F, G>,
  s8: Stage<G, PlannerCandidate>,
): Planner;
export function pipeline<A, B, C, D, E, F, G, H>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, F>,
  s7: Stage<F, G>,
  s8: Stage<G, H>,
  s9: Stage<H, PlannerCandidate>,
): Planner;
export function pipeline(...stages: readonly Stage<never, unknown>[]): Planner {
  const chain = stages as readonly Stage<unknown, unknown>[];
  return async (input, ctx) => {
    let value: unknown = input;
    for (const [index, stage] of chain.entries()) {
      if (index > 0 && ctx.signal?.aborted) {
        ctx.logger.info('Request cancelled', {
          messageId: ctx.origin.messageId,
          reason: ctx.signal.reason,
        });
        return err(
          cancellationError(
            'Request cancelled between planner stages',
            ctx.signal.reason,
          ),
        );
      }
      const instrumented = ctx.instrument.stage(
        stageName(stage) ?? `stage-${index}`,
        stage,
      );
      const result: Result<unknown, StageError> = await instrumented(
        value,
        ctx,
      );
      if (isErr(result)) return result;
      value = result.value;
    }
    return ok(value as PlannerCandidate);
  };
}
