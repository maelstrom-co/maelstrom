import type { Planner } from '@maelstrom-co/engine';
import { buildJevPlanner } from '../jev-planner.js';
import type { JevDeps } from '../stages/stage-deps.js';
import {
  type ScreenScopeOptions,
  selectGatedScreenScope,
} from '../stages-experimental/select-gated-screen-scope.js';

/**
 * The POC composition (actions, layout and the completion call, with the
 * LLM fallback) with `selectGatedScreenScope` as its select stage, on any
 * provider's `deps.ask`. Beside the screen scope question, that select
 * also asks the four gate questions and adds the gated select's gate
 * deferrals (`scope_unsupported` on a `generatedContent` yes,
 * `screen_content_unavailable` on a `dependsOnScreen` yes), which the POC's
 * own select lacks. The actions and layout stages here read no gate
 * answers, so {@link ScreenScopeOptions.spelledOutActionsGate} only rewords
 * a question whose answer nothing uses.
 *
 * @experimental
 */
export function buildPocScreenScopePlanner(
  deps: JevDeps,
  options: ScreenScopeOptions = {},
): Planner {
  return buildJevPlanner(deps, {
    select: (ask) => selectGatedScreenScope(ask, options),
  });
}
