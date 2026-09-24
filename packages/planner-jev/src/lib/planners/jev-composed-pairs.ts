import type { Planner } from '@maelstrom-co/engine';

import type { Instrument, JevPlannerOptions } from '../jev-planner.js';
import { actionsBatchedPerInstance } from '../stages/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { layoutComposedPairsGateAndDefer } from '../stages/layout-composed-pairs-gate-and-defer.js';
import { selectGated } from '../stages/select-gated.js';
import { createJevDeps, type JevDeps } from '../stages/stage-deps.js';
import { buildJevStagePlanner } from './jev-stage-planner.js';

/**
 * The stage-library planner with gated select, per-instance batched
 * actions, the composed pairs gate-and-defer layout and the completion
 * call, with the LLM fallback. {@link jevComposedPairsPlanner} is this
 * without instrumentation.
 */
export function buildJevComposedPairsPlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return buildJevStagePlanner(
    {
      select: selectGated,
      actions: actionsBatchedPerInstance,
      layout: layoutComposedPairsGateAndDefer,
      complete: completeLayoutInline,
    },
    deps,
    instrument,
  );
}

/**
 * Experimental tiling planner that composes the layout from Jev's answers
 * about pairs of visible instances instead of choosing from precomputed
 * layouts. Takes the same options as `jevPlanner` and runs the same way:
 * an Engine with `retry: false` and an unwrapped `fallback`.
 *
 * One Jev call selects instances and answers three yes/no gates (whether
 * actions are needed, whether content must be generated, whether an
 * arrangement is stated). A generated-content yes defers. One Jev call
 * plans up to two actions per instance and binds their parameters. With
 * two to six visible instances, one Jev call asks where the request puts
 * each pair of instances and how much space each one gets, and code builds
 * the best-scoring tree that fits the Chart. When no tree fits, the
 * request re-plans with `fallback`; with more than six visible instances
 * the completion call writes the layout. The completion call then writes
 * the reply as in `jevPlanner`.
 *
 * Not the package default: `jevPlanner` passed more holdout scenarios in
 * the comparison eval. This planner is selectable in the local demo for
 * trying the composed layout in a real UI. Server-only: the TypeSafe key
 * must never reach a browser.
 *
 * @experimental
 * @throws {Error} If `fallback` is not a stage or `adapter` is missing.
 *   The message never contains the key.
 *
 * @example
 * ```ts
 * const engine = createEngine({
 *   planner: jevComposedPairsPlanner({
 *     typesafe: { apiKey: process.env.TYPESAFE_API_KEY, model: 'jev-1.13.0' },
 *     adapter,
 *     fallback: llmPlanner({ adapter }),
 *   }),
 *   retry: false,
 * });
 * ```
 */
export function jevComposedPairsPlanner(options: JevPlannerOptions): Planner {
  return buildJevComposedPairsPlanner(createJevDeps(options));
}
