import { describe, expect, test } from 'bun:test';

import { percentile, renderMarkdown, summarize } from './report.js';
import type { RunRecord } from './run.js';

const pass = { pass: true, failures: [] };
const fail = { pass: false, failures: ['x'] };

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    scenarioId: 's',
    suite: 'development',
    arm: 'jev',
    kind: 'jev-poc',
    repeat: 1,
    turnMs: 100,
    expectedDeferral: false,
    ...overrides,
  };
}

describe('percentile', () => {
  test('uses the nearest rank', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 95)).toBe(5);
    expect(percentile([], 50)).toBe(undefined);
  });
});

describe('summarize', () => {
  const records: RunRecord[] = [
    record({
      score: pass,
      turnMs: 100,
      stageScores: { selection: pass, actions: pass, layout: pass },
    }),
    record({
      score: fail,
      turnMs: 300,
      fallbackCalls: 1,
      deferral: {
        stage: 'jevLayout',
        reason: 'jevLayout/layout_unavailable',
        provider: false,
      },
      stageScores: { selection: pass, actions: fail },
    }),
    record({
      score: pass,
      turnMs: 200,
      fallbackCalls: 1,
      deferral: {
        stage: 'jevSelect',
        reason: 'jevSelect/provider_timeout',
        provider: true,
      },
    }),
    record({
      expectedDeferral: true,
      deferredAsExpected: true,
      fallbackCalls: 1,
    }),
    record({
      score: pass,
      fill: { slots: 2, filled: 1 },
      jevCalls: [
        {
          stage: 'jevSelect',
          questionIds: ['scope'],
          latencyMs: 40,
          outcome: 'ok',
          usage: { inputTokens: 10, outputTokens: 1 },
        },
        {
          stage: 'jevLayout',
          questionIds: ['layout'],
          latencyMs: 60,
          outcome: 'ok',
          usage: { inputTokens: 5, outputTokens: 1 },
        },
      ],
      stages: [{ stage: 'jevSelect', ms: 45, outcome: 'ok' }],
    }),
    record({ arm: 'baseline', kind: 'baseline', score: pass }),
    record({ arm: 'baseline', kind: 'baseline', expectedDeferral: true }),
  ];
  const summaries = summarize(records);
  const jev = summaries.find((s) => s.arm === 'jev' && s.suite === 'all');
  const baseline = summaries.find(
    (s) => s.arm === 'baseline' && s.suite === 'all',
  );

  test('excludes expected deferrals from both arms’ overall pass rate', () => {
    expect(jev?.overall).toEqual({ count: 3, total: 4 });
    expect(jev?.expectedDeferrals).toEqual({ count: 1, total: 1 });
    expect(baseline?.overall).toEqual({ count: 1, total: 1 });
  });

  test('splits fallbacks by stage with provider failures separate', () => {
    expect(jev?.fallbacks?.total).toEqual({ count: 3, total: 5 });
    expect(jev?.fallbacks?.byStage).toEqual({ jevLayout: 1 });
    expect(jev?.fallbacks?.providerByStage).toEqual({ jevSelect: 1 });
  });

  test('reports per-stage accuracy, fill rate, latency and Jev tokens', () => {
    expect(jev?.stages).toEqual({
      selection: { count: 2, total: 2 },
      actions: { count: 1, total: 2 },
      layout: { count: 1, total: 1 },
    });
    expect(jev?.fill).toEqual({ count: 1, total: 2 });
    expect(jev?.latency.turn.p50).toBe(100);
    expect(jev?.latency.jevCall).toEqual({ p50: 40, p95: 60, samples: 2 });
    expect(jev?.latency.stages?.jevSelect?.p50).toBe(45);
    expect(jev?.tokens.jev).toEqual({ calls: 2, input: 15, output: 2 });
  });

  test('marks LLM tokens unavailable', () => {
    expect(jev?.tokens.llm).toBe('unavailable');
    expect(baseline?.tokens).toEqual({ llm: 'unavailable' });
    const markdown = renderMarkdown(summaries, { repeats: 1 });
    expect(markdown).toContain('| LLM tokens | unavailable | unavailable |');
    expect(markdown).toContain('| Overall pass | 3/4 (75.0%) | 1/1 (100.0%) |');
  });
});
