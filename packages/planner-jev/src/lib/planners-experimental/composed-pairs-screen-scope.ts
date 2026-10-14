import type { Planner } from '@maelstrom-co/engine';
import { buildJevStagePlanner } from '../planners/jev-stage-planner.js';
import { actionsBatchedPerInstance } from '../stages/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { layoutComposedPairsGateAndDefer } from '../stages/layout-composed-pairs-gate-and-defer.js';
import {
  type ScreenScopeOptions,
  selectGatedScreenScope,
} from '../stages/select-gated-screen-scope.js';
import type { JevDeps } from '../stages/stage-deps.js';
import type { GatedSelection } from '../stages/stage-types.js';
import { layoutComposedPairsAnswerableFractions } from '../stages-experimental/layout-composed-pairs-answerable-fractions.js';

/** What {@link buildComposedPairsScreenScopePlanner} takes beside its deps. */
export interface ComposedPairsScreenScopeOptions extends ScreenScopeOptions {
  /** Tells the layout's fraction questions what to answer when none is stated, so Decisions does not refuse them. */
  readonly answerableFractions?: boolean;
}

/**
 * The composed pairs planner (batched per-instance actions, the composed
 * pairs layout with gate and defer, the inline completion, the LLM
 * fallback) with `selectGatedScreenScope` as its select stage, on any
 * provider's `deps.ask`, with the screen scope and layout options exposed.
 * Without options it builds what `buildJevComposedPairsPlanner` builds.
 *
 * @experimental
 */
export function buildComposedPairsScreenScopePlanner(
  deps: JevDeps,
  options: ComposedPairsScreenScopeOptions = {},
): Planner {
  return buildJevStagePlanner<GatedSelection>(
    {
      select: (ask) => selectGatedScreenScope(ask, options),
      actions: actionsBatchedPerInstance,
      layout:
        options.answerableFractions === true
          ? layoutComposedPairsAnswerableFractions
          : layoutComposedPairsGateAndDefer,
      complete: completeLayoutInline,
    },
    deps,
  );
}
