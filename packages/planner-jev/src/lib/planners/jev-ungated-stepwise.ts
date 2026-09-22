import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { stepwiseActions } from '../stages-experimental/actions-stepwise.js';
import { completeWithLayout } from '../stages-experimental/complete.js';
import type { JevDeps } from '../stages-experimental/deps.js';
import { menuLayout } from '../stages-experimental/layout-menu.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';

/**
 * The plain stage-library planner: ungated select, stepwise actions, the
 * menu layout and the completion call, with the LLM fallback. Stages keep
 * the POC's names, so `instrument` records and replays them alike.
 */
export function buildJevUngatedStepwisePlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectUngated(deps.ask)),
      instrument('jevActions', stepwiseActions(deps.ask)),
      instrument('jevLayout', menuLayout(deps.ask)),
      instrument('llmComplete', completeWithLayout(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
