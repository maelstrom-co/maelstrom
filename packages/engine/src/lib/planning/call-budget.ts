import { err, ok } from '@maelstrom-co/protocol';

import type { PlanningCallBudget } from './contracts.js';

/** Creates the shared non-refundable logical provider-call budget. */
export function createPlanningCallBudget(maximum: number): PlanningCallBudget {
  let remaining = maximum;
  return Object.freeze({
    get remaining() {
      return remaining;
    },
    claim() {
      if (remaining === 0) return err({ kind: 'budget_exhausted' as const });
      remaining -= 1;
      return ok(undefined);
    },
  });
}
