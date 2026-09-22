import { ok } from '@maelstrom-co/protocol';

import { isResizeOnly } from '../questions.js';
import type { Ask } from '../typesafe-client.js';
import { actionPlanOf } from './action-plan.js';
import { stepwiseActions } from './actions-stepwise.js';
import type { ActionsStage } from './types.js';

/**
 * The stepwise actions behind the `needsActions` gate: a resize-only
 * request, or a gate answering no, plans no actions and makes no call;
 * anything else runs {@link stepwiseActions} unchanged.
 */
export function gatedStepwiseActions(ask: Ask): ActionsStage {
  const stage = stepwiseActions(ask);
  return async (selection, ctx) => {
    if (
      isResizeOnly(selection.input.request) ||
      selection.gates?.needsActions?.answer === 'no'
    )
      return ok(actionPlanOf(selection, [], [], []));
    return stage(selection, ctx);
  };
}
