import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { selectGated } from '../stages/select-gated.js';
import type { JevDeps } from '../stages/stage-deps.js';
import { actionsStepwiseGated } from '../stages-experimental/actions-stepwise-gated.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';

/**
 * The stage-library planner with gated select, the gated stepwise actions, the preset
 * layout and the completion call, with the LLM fallback.
 */
export function buildJevGatedStepwisePlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectGated(deps.ask)),
      instrument('jevActions', actionsStepwiseGated(deps.ask)),
      instrument('jevLayout', layoutPreset(deps.ask)),
      instrument('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
