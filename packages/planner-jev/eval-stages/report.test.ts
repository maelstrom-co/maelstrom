import { describe, expect, test } from 'bun:test';

import type { LayoutTurnDetail } from './layout.js';
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
  turn('composed-pairs', 'swap', 'pass', { jevCalls: [call(200)] }),
  turn('composed-pairs', 'swap', 'handed_off', {
    jevCalls: [call(400)],
    detail: { source: 'llm', answers: [] },
  }),
  turn('composed-pairs', 'focus', 'fail', { jevCalls: [call(300)] }),
  turn('composed-pairs', 'focus', 'deferred', {
    reason: 'jevLayout/provider_timeout',
  }),
  turn('composed-pairs', 'missing-enum', 'not_applicable', {
    reason: 'expects a deferral',
  }),
  turn('preset-or-llm', 'swap', 'handed_off'),
  turn('preset-or-llm', 'swap', 'handed_off'),
  turn('preset-or-llm', 'focus', 'pass'),
  turn('preset-or-llm', 'focus', 'pass'),
  turn('preset-or-llm', 'missing-enum', 'not_applicable'),
];

describe('stage eval report', () => {
  test('summarises pass, hand-offs, deferrals and not-applicable scenarios apart', () => {
    const summary = summarizeVariant(RECORDS, 'composed-pairs');
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
      ['composed-pairs', 'preset-or-llm'],
      { suite: 'development' },
    );
    expect(report).toContain('| Metric | composed-pairs | preset-or-llm |');
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
    expect(
      renderScenarioTable(RECORDS, ['composed-pairs', 'preset-or-llm']),
    ).toBe(
      [
        '| Scenario | composed-pairs | preset-or-llm |',
        '| --- | --- | --- |',
        '| swap | 1/2 h1 | 0/2 h2 |',
        '| focus | 0/2 d1 | 2/2 |',
        '| missing-enum | n/a | n/a |',
      ].join('\n'),
    );
  });

  test('keeps expected layout deferrals out of the main rows and reports them apart', () => {
    const expectedDeferral = 'jevLayout/no_feasible_layout';
    const records = [
      turn('composed-pairs', 'focus', 'pass', { jevCalls: [call(100)] }),
      turn('composed-pairs', 'small-chart', 'pass', {
        expectedDeferral,
        reason: expectedDeferral,
        jevCalls: [call(100)],
      }),
      turn('composed-pairs', 'small-chart', 'handed_off', { expectedDeferral }),
      turn('composed-pairs', 'small-chart', 'fail', { expectedDeferral }),
      turn('composed-pairs', 'small-chart', 'deferred', {
        expectedDeferral,
        reason: 'jevLayout/provider_http',
      }),
    ];
    const summary = summarizeVariant(records, 'composed-pairs');
    expect(summary.turns).toBe(1);
    expect(summary.pass).toEqual({ count: 1, total: 1 });
    expect(summary.deferralReasons).toEqual({});
    expect(summary.jevCallsPerTurn).toBe(1);
    expect(summary.expectedDeferrals).toEqual({
      turns: 4,
      deferredRight: 1,
      handedOff: 1,
      wroteTree: 1,
      otherDeferral: 1,
    });
    const report = renderStageReport(
      'jevLayout',
      records,
      ['composed-pairs'],
      {},
    );
    expect(report).toContain(
      '| Expected layout deferrals: deferred with the right reason | 1/4 (25%) |',
    );
    expect(report).toContain(
      '| Expected layout deferrals: handed off / wrote a tree / other deferral | 1 / 1 / 1 |',
    );
    expect(
      renderStageReport('jevLayout', RECORDS, ['composed-pairs'], {}),
    ).not.toContain('Expected layout deferrals');
  });
});
