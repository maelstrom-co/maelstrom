import {
  named,
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';
import { STAGE_NAME } from '../defer.js';
import { FALLBACK_RETRIES } from '../planners/jev-stage-planner.js';
import { jevActions } from '../stages/jev-actions.js';
import { jevLayout } from '../stages/jev-layout.js';
import { llmComplete } from '../stages/llm-complete.js';
import type { JevDeps } from '../stages/stage-deps.js';
import {
  type ScreenScopeOptions,
  selectGatedScreenScope,
} from '../stages-experimental/select-gated-screen-scope.js';

/**
 * The POC composition (actions, layout and the completion call, with the
 * LLM fallback) with `selectGatedScreenScope` as its select stage, on any
 * provider's `deps.ask`.
 *
 * @experimental
 */
export function buildPocScreenScopePlanner(
  deps: JevDeps,
  options: ScreenScopeOptions = {},
): Planner {
  return withFallback(
    pipeline(
      named(STAGE_NAME.jevSelect, selectGatedScreenScope(deps.ask, options)),
      named(STAGE_NAME.jevActions, jevActions(deps.ask)),
      named(STAGE_NAME.jevLayout, jevLayout(deps.ask)),
      named(STAGE_NAME.llmComplete, llmComplete(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
