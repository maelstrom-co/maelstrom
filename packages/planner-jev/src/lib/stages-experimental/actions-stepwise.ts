import { isErr, ok } from '@maelstrom-co/protocol';

import { jevActions } from '../stages/jev-actions.js';
import type { ActionsStage } from '../stages/stage-types.js';
import type { Ask } from '../typesafe-client.js';

/**
 * The POC's one-call-per-step actions, recording the lowest confidence of
 * its answers and forwarding the selection's gates.
 */
export function actionsStepwise(ask: Ask): ActionsStage {
  const stage = jevActions(ask);
  return async (selection, ctx) => {
    const result = await stage(selection, ctx);
    if (isErr(result)) return result;
    const plan = result.value;
    return ok({
      ...plan,
      selection,
      minConfidence: Math.min(1, ...plan.answers.map((a) => a.confidence)),
      ...(selection.gates !== undefined && { gates: selection.gates }),
    });
  };
}
