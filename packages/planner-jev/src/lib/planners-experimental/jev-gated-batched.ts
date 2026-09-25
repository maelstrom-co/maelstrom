import {
  named,
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES } from '../jev-planner.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { selectGated } from '../stages/select-gated.js';
import type { JevDeps } from '../stages/stage-deps.js';
import { actionsBatched } from '../stages-experimental/actions-batched.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';

/**
 * The stage-library planner with gated select, state-keyed batched actions, the preset layout and the
 * completion call, with the LLM fallback.
 */
export function buildJevGatedBatchedPlanner(deps: JevDeps): Planner {
  return withFallback(
    pipeline(
      named('jevSelect', selectGated(deps.ask)),
      named('jevActions', actionsBatched(deps.ask)),
      named('jevLayout', layoutPreset(deps.ask)),
      named('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
