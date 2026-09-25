import {
  named,
  type Planner,
  pipeline,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';

import { FALLBACK_RETRIES } from '../jev-planner.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import type { JevDeps } from '../stages/stage-deps.js';
import { actionsStepwise } from '../stages-experimental/actions-stepwise.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';

/**
 * The plain stage-library planner: ungated select, stepwise actions, the
 * preset layout and the completion call, with the LLM fallback. Stages keep
 * the POC's names for `StageContext.instrument`, so it records and replays
 * them alike.
 */
export function buildJevUngatedStepwisePlanner(deps: JevDeps): Planner {
  return withFallback(
    pipeline(
      named('jevSelect', selectUngated(deps.ask)),
      named('jevActions', actionsStepwise(deps.ask)),
      named('jevLayout', layoutPreset(deps.ask)),
      named('llmComplete', completeLayoutInline(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}
