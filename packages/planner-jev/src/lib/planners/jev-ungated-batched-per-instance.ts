import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { actionsBatchedPerInstance } from '../stages-experimental/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages-experimental/complete-layout-inline.js';
import type { JevDeps } from '../stages-experimental/deps.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';

/**
 * The stage-library planner with ungated select, per-instance batched actions, the preset layout and the
 * completion call, with the LLM fallback.
 */
export function buildJevUngatedBatchedPerInstancePlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectUngated(deps.ask)),
      instrument('jevActions', actionsBatchedPerInstance(deps.ask)),
      instrument('jevLayout', layoutPreset(deps.ask)),
      instrument('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
