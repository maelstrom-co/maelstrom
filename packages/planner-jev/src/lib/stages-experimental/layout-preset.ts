import { isErr, ok } from '@maelstrom-co/protocol';

import type { LayoutChoicesDescribeMode } from '../layouts.js';
import { jevLayout } from '../stages/jev-layout.js';
import type { LayoutStage } from '../stages/stage-types.js';
import type { Ask } from '../typesafe-client.js';

/** Options for {@link layoutPreset}. */
export interface LayoutPresetOptions {
  /**
   * How the offered layouts are described to Jev. `'tokens'` (the default)
   * sends exactly the POC's call; `'placements'` names each layout's
   * Instances and positions and drops layouts that place every Instance on
   * the same rectangles.
   */
  readonly describe?: LayoutChoicesDescribeMode;
}

/**
 * The POC's choice over precomputed layouts, as a Jev layout decision.
 * Never hands off: an explicit spatial request no offered layout meets
 * defers, as the POC's `unavailable` choice does.
 */
export function layoutPreset(
  ask: Ask,
  options: LayoutPresetOptions = {},
): LayoutStage {
  const stage = jevLayout(ask, {}, { describe: options.describe });
  return async (plan, ctx) => {
    const result = await stage(plan, ctx);
    if (isErr(result)) return result;
    const { layoutId, tree, answers } = result.value;
    return ok({ plan, source: 'jev', layoutId, tree, answers });
  };
}
