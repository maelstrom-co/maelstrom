import type { Result } from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';

import { cancellationError } from '../errors.js';
import type {
  PipelineOutput,
  PlannerCandidate,
  PlannerOutput,
} from './candidate.js';
import { stageName } from './instrument.js';
import type { Planner, PlanningInput, Stage, StageError } from './stage.js';

/**
 * Composes stages into a {@link Planner}, feeding each stage's output to the
 * next. The first stage takes {@link PlanningInput}, the last produces a
 * {@link PlannerCandidate}, and every adjacent pair must agree on the type in
 * between; a mismatch is a compile error at the offending argument. A last
 * stage that produces a wider {@link PlannerOutput} makes the result as wide,
 * as {@link PipelineOutput} describes: for example a `ClarifyingPlanner`
 * when it may ask for clarification.
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
export function pipeline<Out extends PlannerOutput>(
  s1: Stage<PlanningInput, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, C, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, C, D, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, C, D, E, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, C, D, E, F, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, F>,
  s7: Stage<F, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, C, D, E, F, G, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, F>,
  s7: Stage<F, G>,
  s8: Stage<G, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline<A, B, C, D, E, F, G, H, Out extends PlannerOutput>(
  s1: Stage<PlanningInput, A>,
  s2: Stage<A, B>,
  s3: Stage<B, C>,
  s4: Stage<C, D>,
  s5: Stage<D, E>,
  s6: Stage<E, F>,
  s7: Stage<F, G>,
  s8: Stage<G, H>,
  s9: Stage<H, Out>,
): Stage<PlanningInput, PipelineOutput<Out>>;
export function pipeline(
  ...stages: readonly Stage<never, unknown>[]
): Stage<PlanningInput, PlannerOutput> {
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
    return ok(value as PlannerOutput);
  };
}
