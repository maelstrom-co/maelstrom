import { err, ok } from '@maelstrom-co/protocol';

import type { PlanningCallBudget } from './contracts.js';

/** Creates the shared non-refundable logical provider-call budget. */
export function createPlanningCallBudget(
  maximum: number,
  onClaim?: (
    call: Parameters<PlanningCallBudget['claim']>[0],
    remaining: number,
  ) => void,
): PlanningCallBudget {
  let remaining = maximum;
  return Object.freeze({
    get remaining() {
      return remaining;
    },
    claim(call: Parameters<PlanningCallBudget['claim']>[0]) {
      if (remaining === 0) return err({ kind: 'budget_exhausted' as const });
      remaining -= 1;
      onClaim?.(call, remaining);
      return ok(undefined);
    },
  });
}
