import type { Planner, PlanningInput, Stage } from '@maelstrom-co/engine';

import type { Ask } from '../ask.js';

import type { JevPlannerOptions } from '../jev-planner.js';
import { logTurns } from '../log-turn.js';
import { actionsBatchedPerInstance } from '../stages/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { layoutComposedPairsGateAndDefer } from '../stages/layout-composed-pairs-gate-and-defer.js';
import { selectGatedScreenScope } from '../stages/select-gated-screen-scope.js';
import { createJevDeps, type JevDeps } from '../stages/stage-deps.js';
import type { GatedSelection } from '../stages/stage-types.js';
import { buildJevStagePlanner } from './jev-stage-planner.js';

/** Stage factories that replace the composed pairs planner's own in {@link buildJevComposedPairsPlanner}. */
export interface ComposedPairsStageOverrides {
  /** The select stage in place of `selectGatedScreenScope`. Its gates route the layout stage. */
  readonly select?: (ask: Ask) => Stage<PlanningInput, GatedSelection>;
}

/**
 * The stage-library planner with the screen scope select, per-instance
 * batched actions, the composed pairs gate-and-defer layout and the
 * completion call, with the LLM fallback, with any stage in `overrides` in
 * place of its own. {@link jevComposedPairsPlanner} is this built from the
 * public options with no overrides.
 */
export function buildJevComposedPairsPlanner(
  deps: JevDeps,
  overrides: ComposedPairsStageOverrides = {},
): Planner {
  return buildJevStagePlanner<GatedSelection>(
    {
      select: overrides.select ?? selectGatedScreenScope,
      actions: actionsBatchedPerInstance,
      layout: layoutComposedPairsGateAndDefer,
      complete: completeLayoutInline,
    },
    deps,
  );
}

/**
 * Experimental tiling planner that composes the layout from Jev's answers
 * about pairs of visible instances instead of choosing from precomputed
 * layouts. Takes the same options as `jevPlanner` and runs the same way:
 * an Engine with `retry: false` and an unwrapped `fallback`.
 *
 * One Jev call selects instances, asks whether the request describes the
 * whole screen or adjusts what is shown (on an adjustment every visible
 * instance the request does not explicitly hide stays visible), and
 * answers four yes/no gates (whether actions are needed, whether content
 * must be generated, whether an arrangement is stated, whether the request
 * needs content already on screen). A generated-content or on-screen
 * content yes defers. One Jev call
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
 * import { llmPlanner } from '@maelstrom-co/planner-llm';
 *
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
  const planner = buildJevComposedPairsPlanner(createJevDeps(options));
  return options.typesafe.logReplies === true ? logTurns(planner) : planner;
}
