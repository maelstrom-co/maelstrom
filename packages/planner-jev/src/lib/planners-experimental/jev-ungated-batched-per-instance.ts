import {
  named,
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES } from '../jev-planner.js';
import { actionsBatchedPerInstance } from '../stages/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import type { JevDeps } from '../stages/stage-deps.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';

/**
 * The stage-library planner with ungated select, per-instance batched actions, the preset layout and the
 * completion call, with the LLM fallback.
 */
export function buildJevUngatedBatchedPerInstancePlanner(
  deps: JevDeps,
): Planner {
  return withFallback(
    pipeline(
      named('jevSelect', selectUngated(deps.ask)),
      named('jevActions', actionsBatchedPerInstance(deps.ask)),
      named('jevLayout', layoutPreset(deps.ask)),
      named('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
