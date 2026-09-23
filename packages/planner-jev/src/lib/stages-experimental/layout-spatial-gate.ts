import type { Stage } from '@maelstrom-co/engine';
import { ok } from '@maelstrom-co/protocol';

import { layoutKeepOrDefault } from './layout-keep-or-default.js';
import type { GatedActionPlan, LayoutDecision } from './types.js';

/**
 * Routes on the select stage's `spatial` gate alone, with no Jev call: a
 * stated arrangement hands the layout off to the LLM, otherwise keeps the
 * current tree or falls back to the balanced default.
 */
export function layoutSpatialGate(): Stage<GatedActionPlan, LayoutDecision> {
  return async (plan, ctx) => {
    if (plan.gates.spatial.answer === 'yes')
      return ok({ plan, source: 'llm', answers: [] });
    return layoutKeepOrDefault(plan, ctx);
  };
}
