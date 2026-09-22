import { isErr, ok } from '@maelstrom-co/protocol';

import { jevLayout } from '../stages/jev-layout.js';
import type { Ask } from '../typesafe-client.js';
import type { LayoutStage } from './types.js';

/** The POC's choice over precomputed layouts, as a Jev layout decision. */
export function menuLayout(ask: Ask): LayoutStage {
  const stage = jevLayout(ask);
  return async (plan, ctx) => {
    const result = await stage(plan, ctx);
    if (isErr(result)) return result;
    const { layoutId, tree, answers } = result.value;
    return ok({ plan, source: 'jev', layoutId, tree, answers });
  };
}
