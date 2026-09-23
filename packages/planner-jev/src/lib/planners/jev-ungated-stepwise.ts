import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { actionsStepwise } from '../stages-experimental/actions-stepwise.js';
import { completeLayoutInline } from '../stages-experimental/complete-layout-inline.js';
import type { JevDeps } from '../stages-experimental/deps.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';

/**
 * The plain stage-library planner: ungated select, stepwise actions, the
 * preset layout and the completion call, with the LLM fallback. Stages keep
 * the POC's names, so `instrument` records and replays them alike.
 */
export function buildJevUngatedStepwisePlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectUngated(deps.ask)),
      instrument('jevActions', actionsStepwise(deps.ask)),
      instrument('jevLayout', layoutPreset(deps.ask)),
      instrument('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
