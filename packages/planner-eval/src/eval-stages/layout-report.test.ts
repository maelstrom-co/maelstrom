import { describe, expect, test } from 'bun:test';

import type { ComposedPairsRecord } from '@maelstrom-co/planner-jev/_internal';
import { LAYOUT_VARIANTS, type LayoutTurnDetail } from './layout.js';
import {
  renderArrangementNotAskedSection,
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
    variant: 'composed-pairs',
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
      summarizeComposedPairs(records, 'composed-pairs')?.sizeFallbacks,
    ).toEqual({ raised_to_minimum: 1, equal_weights: 1 });
    expect(renderComposedPairsSection(records, ['composed-pairs'])).toContain(
      '| Size fallback: raised to minimum / equal weights | 1 / 1 |',
    );
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
    const summary = summarizeComposedPairs(records, 'composed-pairs');
    expect(summary?.sizeRuleFailures).toBe(2);
    expect(summary?.sizeConfidence).toEqual({ p10: 0.5, p50: 0.7, p90: 1 });
    const section = renderComposedPairsSection(records, ['composed-pairs']);
    expect(section).toContain(
      '| Turns failing a size rule (weightRatio or dominant) | 2 |',
    );
    expect(section).toContain(
      '| Size answer confidence p10 / p50 / p90 | 0.50 / 0.70 / 1.00 |',
    );
  });

  test('registers the layout stage of every arm as a variant', () => {
    expect(Object.keys(LAYOUT_VARIANTS)).toEqual([
      'preset',
      'preset-or-llm',
      'composed-pairs',
    ]);
  });
});

describe('arrangement not asked report', () => {
  const usage = { inputTokens: 300, outputTokens: 30 };
  function notAsked(
    variant: string,
    changed: boolean,
    calls: number,
  ): StageTurnRecord<LayoutTurnDetail> {
    return {
      stage: 'jevLayout',
      variant,
      scenarioId: 'preserve',
      suite: 'development',
      repeat: 1,
      outcome: changed ? 'fail' : 'pass',
      failures: [],
      jevCalls: Array.from({ length: calls }, () => ({
        stage: 'jevLayout' as const,
        questionIds: [],
        latencyMs: 100,
        outcome: 'ok' as const,
        usage,
      })),
      detail: {
        source: calls > 0 ? 'jev' : 'preserve',
        answers: [],
        arrangementNotAsked: { changed },
      },
    };
  }

  test('counts changed layouts and cost on the turns that ask no arrangement', () => {
    const section = renderArrangementNotAskedSection(
      [
        notAsked('gate', false, 0),
        notAsked('gate', false, 0),
        notAsked('asks', true, 1),
        notAsked('asks', false, 1),
      ],
      ['gate', 'asks'],
    );
    expect(section).toContain('| Metric | gate | asks |');
    expect(section).toContain(
      '| Turns that ask no arrangement (same Instances, current tree fits) | 2 | 2 |',
    );
    expect(section).toContain('| Changed the layout | 0/2 (0%) | 1/2 (50%) |');
    expect(section).toContain('| Jev calls per turn | 0.00 | 1.00 |');
    expect(section).toContain(
      '| Jev tokens per turn (input / output) | 0 / 0 | 300 / 30 |',
    );
  });

  test('is absent when no turn asks no arrangement', () => {
    expect(renderArrangementNotAskedSection([], ['gate'])).toBeUndefined();
  });
});
