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
  failures: readonly string[] = [],
): StageTurnRecord<LayoutTurnDetail> {
  return {
    stage: 'jevLayout',
    variant: 'composed-pairs-size-fallback',
    scenarioId: 'bottom-strip',
    suite: 'development',
    repeat: 1,
    outcome: failures.length === 0 ? 'pass' : 'fail',
    failures,
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

  test('counts turns failing a size rule and the size answer confidence', () => {
    const size = (confidence: number) => ({
      level: '2',
      score: 2,
      confidence,
      probabilities: { 2: 1 },
      size: 0.5,
    });
    const records = [
      turn({ ...CALLED, sizes: { a: size(0.5), b: size(0.9) } }, [
        'Arrangement weightRatio(a, b, 1.6..2.5): a/b area ratio 1.5, outside 1.6..2.5',
      ]),
      turn({ ...CALLED, sizes: { a: size(0.7) } }, [
        'Arrangement dominant(a, 0.6): a has share 0.5',
      ]),
      turn({ ...CALLED, sizes: { a: size(1) } }, [
        'Arrangement leftOf(a, b): a is not left of b',
      ]),
    ];
    const summary = summarizeComposedPairs(
      records,
      'composed-pairs-size-fallback',
    );
    expect(summary?.sizeRuleFailures).toBe(2);
    expect(summary?.sizeConfidence).toEqual({ p10: 0.5, p50: 0.7, p90: 1 });
    const section = renderComposedPairsSection(records, [
      'composed-pairs-size-fallback',
    ]);
    expect(section).toContain(
      '| Turns failing a size rule (weightRatio or dominant) | 2 |',
    );
    expect(section).toContain(
      '| Size answer confidence p10 / p50 / p90 | 0.50 / 0.70 / 1.00 |',
    );
  });

  test('registers the size variants built on the combined variant', () => {
    expect(Object.keys(LAYOUT_VARIANTS)).toEqual(
      expect.arrayContaining([
        'composed-pairs-fraction-sizes',
        'composed-pairs-score-when-confident',
        'composed-pairs-size-comparisons',
      ]),
    );
  });

  test('registers the limited redirect and proportional fallback variants', () => {
    expect(Object.keys(LAYOUT_VARIANTS)).toEqual(
      expect.arrayContaining([
        'composed-pairs-combined-limited-redirect',
        'composed-pairs-fraction-sizes-proportional-fallback',
        'composed-pairs-fraction-sizes-both-fixes',
      ]),
    );
  });

  test('registers the combined composed pairs variant', () => {
    expect(Object.keys(LAYOUT_VARIANTS)).toContain('composed-pairs-combined');
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
