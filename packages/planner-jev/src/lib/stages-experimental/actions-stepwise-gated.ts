import { ok } from '@maelstrom-co/protocol';

import { isResizeOnly } from '../questions.js';
import type { Ask } from '../typesafe-client.js';
import { actionPlanOf } from './action-plan.js';
import { actionsStepwise } from './actions-stepwise.js';
import type { ActionsStage } from './types.js';

/**
 * The stepwise actions behind the `needsActions` gate: a resize-only
 * request, or a gate answering no, plans no actions and makes no call;
 * anything else runs {@link actionsStepwise} unchanged.
 */
export function actionsStepwiseGated(ask: Ask): ActionsStage {
  const stage = actionsStepwise(ask);
  return async (selection, ctx) => {
    if (
      isResizeOnly(selection.input.request) ||
      selection.gates?.needsActions?.answer === 'no'
    )
      return ok(actionPlanOf(selection, [], [], []));
    return stage(selection, ctx);
  };
}
