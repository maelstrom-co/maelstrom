import {
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES, type Instrument } from '../jev-planner.js';
import { stepwiseActions } from '../stages-next/actions-stepwise.js';
import { completeWithLayout } from '../stages-next/complete.js';
import type { JevDeps } from '../stages-next/deps.js';
import { l0Layout } from '../stages-next/layout-l0.js';
import { selectV1 } from '../stages-next/select-v1.js';

/**
 * The POC composition rebuilt from the stage library: the same Jev calls,
 * the same completion call and the same fallback as `jevPlanner`. Stages
 * keep the POC's names, so `instrument` records and replays them alike.
 */
export function buildJevPocRebuiltPlanner(
  deps: JevDeps,
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  return withFallback(
    pipeline(
      instrument('jevSelect', selectV1(deps.ask)),
      instrument('jevActions', stepwiseActions(deps.ask)),
      instrument('jevLayout', l0Layout(deps.ask)),
      instrument('llmComplete', completeWithLayout(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
