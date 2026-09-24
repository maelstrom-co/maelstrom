import type { Stage } from '@maelstrom-co/engine';

import type { Ask } from '../typesafe-client.js';
import {
  type ComposedPairsDecision,
  type ComposedPairsOptions,
  layoutComposedPairsWithOptions,
} from './layout-composed-pairs.js';
import type { GatedActionPlan } from './types.js';

/**
 * The composed-pairs options {@link layoutComposedPairsGateAndDefer} builds
 * on: the direction redirect only when the answer changes the top split,
 * the size fallback, the whole-board examples, sizes asked as fractions
 * within each row or column, and what stated fractions leave split by
 * whole-Chart shares.
 */
export const COMPOSED_PAIRS_BOTH_FIXES_OPTIONS = {
  direction: 'redirects_not_stated_when_direction_changes',
  sizeFallback: true,
  wholeBoardExamples: true,
  sizeAnswers: {
    kind: 'fractions_within_part',
    unstatedSplit: 'whole_chart_shares',
  },
} as const satisfies Omit<ComposedPairsOptions, 'layoutId'>;

/** The `layoutId` a tree written by {@link layoutComposedPairsGateAndDefer} carries. */
export const COMPOSED_PAIRS_GATE_AND_DEFER_LAYOUT_ID =
  'composed-pairs-gate-and-defer-combined';

/**
 * {@link COMPOSED_PAIRS_BOTH_FIXES_OPTIONS} that never keeps the current
 * tree on the spatial gate alone, so two or more visible Instances are
 * always asked about, and defers with `jevLayout/no_feasible_layout` when
 * nothing fits, so the fallback planner answers the turn. More than six
 * visible Instances still hand off to the completion call.
 */
export function layoutComposedPairsGateAndDefer(
  ask: Ask,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  return layoutComposedPairsWithOptions(ask, {
    ...COMPOSED_PAIRS_BOTH_FIXES_OPTIONS,
    layoutId: COMPOSED_PAIRS_GATE_AND_DEFER_LAYOUT_ID,
    spatialGate: 'never_skips',
    nothingFits: 'defers',
  });
}
