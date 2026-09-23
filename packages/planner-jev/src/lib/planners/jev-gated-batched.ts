import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { actionsBatched } from '../stages-experimental/actions-batched.js';
import { completeLayoutInline } from '../stages-experimental/complete-layout-inline.js';
import type { JevDeps } from '../stages-experimental/deps.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';
import { selectGated } from '../stages-experimental/select-gated.js';

/**
 * The stage-library planner with gated select, state-keyed batched actions, the preset layout and the
 * completion call, with the LLM fallback.
 */
export function buildJevGatedBatchedPlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectGated(deps.ask)),
      instrument('jevActions', actionsBatched(deps.ask)),
      instrument('jevLayout', layoutPreset(deps.ask)),
      instrument('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
