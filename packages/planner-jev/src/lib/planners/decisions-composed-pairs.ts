import type { Planner } from '@maelstrom-co/engine';

import { logTurns } from '../log-turn.js';
import { createDecisionsClient } from '../openai-decisions-client.js';
import { actionsBatchedPerInstance } from '../stages/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { layoutComposedPairsGateAndDefer } from '../stages/layout-composed-pairs-gate-and-defer.js';
import { selectGated } from '../stages/select-gated.js';
import type { JevDeps } from '../stages/stage-deps.js';
import type { DecisionsPlannerOptions } from './decisions-planner.js';
import { buildJevStagePlanner, createStageDeps } from './jev-stage-planner.js';

/**
 * The stage-library planner with gated select, per-instance batched
 * actions, the composed pairs gate-and-defer layout and the completion
 * call, with the LLM fallback, over `deps`, whose `ask` may be any
 * provider. {@link decisionsComposedPairsPlanner} is this with the
 * Decisions client.
 */
export function buildDecisionsComposedPairsPlanner(deps: JevDeps): Planner {
  return buildJevStagePlanner(
    {
      select: selectGated,
      actions: actionsBatchedPerInstance,
      layout: layoutComposedPairsGateAndDefer,
      complete: completeLayoutInline,
    },
    deps,
  );
}

/**
 * Experimental tiling planner that composes the layout from OpenAI
 * Decisions' answers about pairs of visible instances, asking the same
 * questions `jevComposedPairsPlanner` asks TypeSafe Jev. Takes the same
 * options as `decisionsPlanner` and runs the same way: an Engine with
 * `retry: false` and an unwrapped `fallback`.
 *
 * One Decisions call selects instances and answers three yes/no gates
 * (whether actions are needed, whether content must be generated, whether
 * an arrangement is stated). A generated-content yes defers. One Decisions
 * call plans up to two actions per instance and binds their parameters.
 * With two to six visible instances, one Decisions call asks where the
 * request puts each pair of instances and how much space each one gets,
 * and code builds the best-scoring tree that fits the Chart. When no tree
 * fits, or Decisions refuses any question, the request re-plans with
 * `fallback`; with more than six visible instances the completion call
 * writes the layout. The completion call then writes the reply.
 *
 * Not a package default. Needs only an OpenAI key; no TypeSafe key.
 * Server-only: the OpenAI key must never reach a browser.
 *
 * @experimental
 * @throws {Error} If an option is invalid, `fallback` is not a stage or
 *   `adapter` is missing. The message never contains the key.
 *
 * @example
 * ```ts
 * import { llmPlanner } from '@maelstrom-co/planner-llm';
 *
 * const engine = createEngine({
 *   planner: decisionsComposedPairsPlanner({
 *     decisions: { apiKey: process.env.OPENAI_API_KEY },
 *     adapter,
 *     fallback: llmPlanner({ adapter }),
 *   }),
 *   retry: false,
 * });
 * ```
 */
export function decisionsComposedPairsPlanner(
  options: DecisionsPlannerOptions,
): Planner {
  const planner = buildDecisionsComposedPairsPlanner(
    createStageDeps(
      createDecisionsClient(options.decisions),
      options,
      'DecisionsPlannerOptions',
    ),
  );
  return options.decisions.logReplies === true ? logTurns(planner) : planner;
}
