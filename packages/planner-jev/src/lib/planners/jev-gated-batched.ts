import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { batchedActions } from '../stages-experimental/actions-batched.js';
import { completeWithLayout } from '../stages-experimental/complete.js';
import type { JevDeps } from '../stages-experimental/deps.js';
import { menuLayout } from '../stages-experimental/layout-menu.js';
import { selectWithGates } from '../stages-experimental/select-gate.js';

/**
 * The stage-library planner with gated select, state-keyed batched actions, the menu layout and the
 * completion call, with the LLM fallback.
 */
export function buildJevGatedBatchedPlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectWithGates(deps.ask)),
      instrument('jevActions', batchedActions(deps.ask)),
      instrument('jevLayout', menuLayout(deps.ask)),
      instrument('llmComplete', completeWithLayout(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
