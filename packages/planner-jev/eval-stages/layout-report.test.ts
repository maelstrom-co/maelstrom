import { describe, expect, test } from 'bun:test';

import type { ComposedPairsRecord } from '../src/lib/stages-experimental/layout-composed-pairs.js';
import { LAYOUT_VARIANTS, type LayoutTurnDetail } from './layout.js';
import {
  renderComposedPairsSection,
  summarizeComposedPairs,
} from './layout-report.js';
import type { StageTurnRecord } from './stage-eval.js';

function turn(
  pairwise: ComposedPairsRecord,
): StageTurnRecord<LayoutTurnDetail> {
  return {
    stage: 'jevLayout',
    variant: 'composed-pairs-size-fallback',
    scenarioId: 'bottom-strip',
    suite: 'development',
    repeat: 1,
    outcome: 'pass',
    failures: [],
    jevCalls: [],
    detail: { source: 'jev', answers: [], pairwise },
  };
}

const CALLED = { route: 'spatial', called: true, candidates: [] } as const;

describe('composed pairs report', () => {
  test('counts the size fallbacks that wrote the returned tree', () => {
    const records = [
      turn({
        ...CALLED,
        fallback: { kind: 'raised_to_minimum', candidate: 0 },
      }),
      turn({ ...CALLED, fallback: { kind: 'equal_weights', candidate: 1 } }),
      turn({ ...CALLED, chosen: 0 }),
    ];
    expect(
      summarizeComposedPairs(records, 'composed-pairs-size-fallback')
        ?.sizeFallbacks,
    ).toEqual({ raised_to_minimum: 1, equal_weights: 1 });
    expect(
      renderComposedPairsSection(records, ['composed-pairs-size-fallback']),
    ).toContain('| Size fallback: raised to minimum / equal weights | 1 / 1 |');
  });

  test('registers every composed pairs fix as a layout variant', () => {
    expect(Object.keys(LAYOUT_VARIANTS)).toEqual(
      expect.arrayContaining([
        'composed-pairs-direction-redirects-not-stated',
        'composed-pairs-size-fallback',
        'composed-pairs-whole-board-examples',
        'composed-pairs-size-within-part',
        'composed-pairs-part-size-max',
        'composed-pairs-bigger-size-steps',
        'composed-pairs-lean-state',
      ]),
    );
  });
});
