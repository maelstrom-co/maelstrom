import { describe, expect, test } from 'bun:test';

import type { LayoutTurnDetail } from './layout.js';
import { renderComposedSection, summarizeComposed } from './layout-report.js';
import {
  renderScenarioTable,
  renderStageReport,
  summarizeVariant,
} from './report.js';
import type { StageOutcome, StageTurnRecord } from './stage-eval.js';

function turn(
  variant: string,
  scenarioId: string,
  outcome: StageOutcome,
  extra: Partial<StageTurnRecord<LayoutTurnDetail>> = {},
): StageTurnRecord<LayoutTurnDetail> {
  return {
    stage: 'jevLayout',
    variant,
    scenarioId,
    suite: 'development',
    repeat: 1,
    outcome,
    failures: [],
    jevCalls: [],
    ...(outcome !== 'not_applicable' && { stageMs: 10 }),
    ...extra,
  };
}

const call = (latencyMs: number) => ({
  stage: 'jevLayout' as const,
  questionIds: ['shape'],
  latencyMs,
  outcome: 'ok' as const,
  usage: { inputTokens: 100, outputTokens: 10 },
});

const RECORDS: StageTurnRecord<LayoutTurnDetail>[] = [
  turn('composed', 'swap', 'pass', { jevCalls: [call(200)] }),
  turn('composed', 'swap', 'handed_off', {
    jevCalls: [call(400)],
    detail: {
      source: 'llm',
      answers: [],
      composition: {
        route: 'spatial',
        called: true,
        nudged: false,
        sizeLevels: 5,
        candidates: [],
        handOff: 'none_of_these',
      },
      miss: { question: 'shape' },
    },
  }),
  turn('composed', 'focus', 'fail', { jevCalls: [call(300)] }),
  turn('composed', 'focus', 'deferred', {
    reason: 'jevLayout/provider_timeout',
  }),
  turn('composed', 'missing-enum', 'not_applicable', {
    reason: 'expects a deferral',
  }),
  turn('spatial-gate', 'swap', 'handed_off'),
  turn('spatial-gate', 'swap', 'handed_off'),
  turn('spatial-gate', 'focus', 'pass'),
  turn('spatial-gate', 'focus', 'pass'),
  turn('spatial-gate', 'missing-enum', 'not_applicable'),
];

describe('stage eval report', () => {
  test('summarises pass, hand-offs, deferrals and not-applicable scenarios apart', () => {
    const summary = summarizeVariant(RECORDS, 'composed');
    expect(summary.turns).toBe(4);
    expect(summary.pass).toEqual({ count: 1, total: 4 });
    expect(summary.passScored).toEqual({ count: 1, total: 2 });
    expect(summary.handedOff).toEqual({ count: 1, total: 4 });
    expect(summary.deferred).toEqual({ count: 1, total: 4 });
    expect(summary.deferralReasons).toEqual({
      'jevLayout/provider_timeout': 1,
    });
    expect(summary.notApplicable).toBe(1);
    expect(summary.jevCallsPerTurn).toBe(0.75);
    expect(summary.jevLatencyMs).toEqual({ p50: 300, p95: 400 });
    expect(summary.jevTokensPerTurn).toEqual({ input: 75, output: 7.5 });
  });

  test('renders one column per variant and a row per deferral reason', () => {
    const report = renderStageReport(
      'jevLayout',
      RECORDS,
      ['composed', 'spatial-gate'],
      { suite: 'development' },
    );
    expect(report).toContain('| Metric | composed | spatial-gate |');
    expect(report).toContain(
      '| Pass (hand-offs and deferrals count as failures) | 1/4 (25%) | 2/4 (50%) |',
    );
    expect(report).toContain(
      '| Pass over trees written (hand-offs and deferrals left out) | 1/2 (50%) | 2/2 (100%) |',
    );
    expect(report).toContain('| Handed off | 1/4 (25%) | 2/4 (50%) |');
    expect(report).toContain('| Not applicable scenarios (not run) | 1 | 1 |');
    expect(report).toContain(
      '| Deferral: jevLayout/provider_timeout | 1 | 0 |',
    );
    expect(report).toContain('- suite: development');
  });

  test('tables every scenario by variant', () => {
    expect(renderScenarioTable(RECORDS, ['composed', 'spatial-gate'])).toBe(
      [
        '| Scenario | composed | spatial-gate |',
        '| --- | --- | --- |',
        '| swap | 1/2 h1 | 0/2 h2 |',
        '| focus | 0/2 d1 | 2/2 |',
        '| missing-enum | n/a | n/a |',
      ].join('\n'),
    );
  });

  test('adds a composed section only for variants that recorded a composition', () => {
    const summary = summarizeComposed(RECORDS, 'composed');
    expect(summary?.routes.spatial).toEqual({ turns: 1, calls: 1 });
    expect(summary?.handOffs.none_of_these).toBe(1);
    expect(summary?.misses.shape).toBe(1);
    expect(summarizeComposed(RECORDS, 'spatial-gate')).toBeUndefined();
    const section = renderComposedSection(RECORDS, [
      'composed',
      'spatial-gate',
    ]);
    expect(section).toContain('| Metric | composed |');
    expect(section).toContain('| Missed turns: shape | 1 |');
    expect(renderComposedSection(RECORDS, ['spatial-gate'])).toBeUndefined();
  });
});
