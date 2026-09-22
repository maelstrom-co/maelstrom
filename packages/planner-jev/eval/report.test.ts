import { describe, expect, test } from 'bun:test';
import { GRADER_VERSION } from './grader.js';
import type { GraderValidation } from './grader-validate.js';
import {
  percentile,
  renderMarkdown,
  renderPaired,
  summarize,
} from './report.js';
import type { RunRecord } from './run.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

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
    arrangementRules: false,
    ...overrides,
  };
}

function baseline(overrides: Partial<RunRecord>): RunRecord {
  return record({ arm: 'baseline', kind: 'baseline', ...overrides });
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
      scenarioId: 'a',
      score: pass,
      turnMs: 100,
      stageScores: { selection: pass, actions: pass, layout: pass },
    }),
    record({
      scenarioId: 'b',
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
      scenarioId: 'c',
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
      scenarioId: 'd',
      expectedDeferral: true,
      deferredAsExpected: true,
      fallbackCalls: 1,
    }),
    record({
      scenarioId: 'e',
      score: fail,
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
      llmCalls: [
        {
          role: 'complete',
          latencyMs: 300,
          usage: { inputTokens: 900, outputTokens: 40, totalTokens: 940 },
        },
      ],
      stages: [
        { stage: 'jevSelect', ms: 45, outcome: 'ok' },
        { stage: 'jevActions', ms: 5, outcome: 'ok', replayed: true },
      ],
    }),
    record({
      scenarioId: 'f',
      arrangementRules: true,
      score: { ...pass, arrangement: pass },
    }),
    record({
      scenarioId: 'g',
      arrangementRules: true,
      score: { ...fail, arrangement: fail },
      spatial: true,
    }),
    baseline({ scenarioId: 'a', score: fail }),
    baseline({
      scenarioId: 'e',
      score: pass,
      llmCalls: [
        {
          role: 'planner',
          latencyMs: 2000,
          usage: { inputTokens: 3000, outputTokens: 500, totalTokens: 3500 },
        },
        { role: 'planner', latencyMs: 1000 },
      ],
    }),
    baseline({
      scenarioId: 'f',
      arrangementRules: true,
      score: { ...fail, arrangement: fail },
    }),
    baseline({ scenarioId: 'd', expectedDeferral: true }),
  ];
  const summaries = summarize(records);
  const jev = summaries.find((s) => s.arm === 'jev' && s.suite === 'all');
  const base = summaries.find((s) => s.arm === 'baseline' && s.suite === 'all');

  test('excludes expected deferrals from every arm’s overall pass rate', () => {
    expect(jev?.overall).toEqual({ count: 3, total: 6 });
    expect(jev?.expectedDeferrals).toEqual({ count: 1, total: 1 });
    expect(base?.overall).toEqual({ count: 1, total: 3 });
  });

  test('lists fallbacks by full reason, with the by-stage split kept', () => {
    expect(jev?.fallbacks?.total).toEqual({ count: 3, total: 7 });
    expect(jev?.fallbacks?.byReason).toEqual({
      'jevLayout/layout_unavailable': 1,
      'jevSelect/provider_timeout': 1,
    });
    expect(jev?.fallbacks?.byStage).toEqual({ jevLayout: 1 });
    expect(jev?.fallbacks?.providerByStage).toEqual({ jevSelect: 1 });
  });

  test('reports stage accuracy, fill rate, live latency and Jev tokens', () => {
    expect(jev?.stages).toEqual({
      selection: { count: 2, total: 2 },
      actions: { count: 1, total: 2 },
      layout: { count: 1, total: 1 },
    });
    expect(jev?.fill).toEqual({ count: 1, total: 2 });
    expect(jev?.latency.turn.p50).toBe(100);
    expect(jev?.latency.jevCall).toEqual({ p50: 40, p95: 60, samples: 2 });
    expect(jev?.latency.stages?.jevSelect?.p50).toBe(45);
    expect(jev?.latency.stages?.jevActions?.samples).toBe(0);
    expect(jev?.replayed).toEqual(['jevActions']);
    expect(jev?.tokens.jev).toEqual({
      calls: 2,
      input: 15,
      output: 2,
      withoutUsage: 0,
      perTurn: { input: 15 / 7, output: 2 / 7 },
    });
  });

  test('scores arrangement only over scenarios that declare rules', () => {
    expect(jev?.arrangement).toEqual({ count: 1, total: 2 });
    expect(base?.arrangement).toEqual({ count: 0, total: 1 });
    expect(jev?.spatial).toEqual({ spatial: 1, controls: 0 });
  });

  test('counts every planned turn on a ruled scenario, an unscored one as a failure', () => {
    const [ruled] = summarize([
      record({
        scenarioId: 'p',
        arrangementRules: true,
        score: { ...pass, arrangement: pass },
      }),
      record({
        scenarioId: 'q',
        arrangementRules: true,
        error: { tag: 'ProviderError', message: 'down' },
      }),
      record({ scenarioId: 'r', arrangementRules: true, score: fail }),
      record({ scenarioId: 's', score: pass }),
      record({
        scenarioId: 't',
        arrangementRules: true,
        expectedDeferral: true,
      }),
    ]);
    expect(ruled?.arrangement).toEqual({ count: 1, total: 3 });
  });

  test('reports LLM calls and tokens by role for every arm', () => {
    expect(jev?.tokens.llm).toEqual({
      calls: 1,
      input: 900,
      output: 40,
      withoutUsage: 0,
      byRole: {
        complete: { calls: 1, input: 900, output: 40, withoutUsage: 0 },
      },
    });
    expect(base?.tokens.llm.byRole).toEqual({
      planner: { calls: 2, input: 3000, output: 500, withoutUsage: 1 },
    });
    expect(base?.latency.llmCall.planner).toEqual({
      p50: 1000,
      p95: 2000,
      samples: 2,
    });
  });

  test('pairs decisive turns with the baseline on the same scenario and repeat', () => {
    expect(jev?.decisive).toEqual({
      pass: { count: 2, total: 4 },
      wins: 2,
      losses: 1,
      paired: 3,
    });
    expect(base?.decisive).toBe(undefined);
  });

  test('renders one column per arm in the order records name them', () => {
    const markdown = renderMarkdown(summaries, {
      repeats: 1,
      replay: { from: '/tmp/run', through: 'actions', arm: 'jev-poc' },
    });
    expect(markdown).toContain('| Metric | jev | baseline |');
    expect(markdown).toContain(
      '- replay: {"from":"/tmp/run","through":"actions","arm":"jev-poc"}',
    );
    expect(markdown).toContain('| Overall pass | 3/6 (50.0%) | 1/3 (33.3%) |');
    expect(markdown).toContain(
      '| Arrangement pass | 1/2 (50.0%) | 0/1 (0.0%) |',
    );
    expect(markdown).toContain(
      '| Fallbacks: jevLayout/layout_unavailable | 1 | n/a |',
    );
    expect(markdown).toContain('| Decisive turns pass | 2/4 (50.0%) | n/a |');
    expect(markdown).toContain(
      '| Decisive wins / losses vs baseline (paired) | 2 / 1 (3) | n/a |',
    );
    expect(markdown).toContain(
      '| jevActions latency p50 / p95 (ms) | replayed | n/a |',
    );
    expect(markdown).toContain(
      '| LLM calls / input / output tokens | 1 / 900 / 40 | 2 / 3000 / 500 (1 without usage) |',
    );
    expect(markdown).toContain(
      '| LLM planner calls / input / output tokens | 0 / 0 / 0 | 2 / 3000 / 500 (1 without usage) |',
    );
    expect(markdown).toContain(
      '| Jev tokens per turn (input / output) | 2.1 / 0.3 | n/a |',
    );
    expect(markdown).toContain(
      '| Spatial gate false positives / negatives | n/a (1 spatial, 0 controls) | n/a (0 spatial, 0 controls) |',
    );
  });
});

describe('gate errors', () => {
  const gate = (question: string, choice: 'yes' | 'no') => ({
    stage: 'jevSelect' as const,
    question,
    choice,
    confidence: 0.5,
  });
  const records: RunRecord[] = [
    record({
      scenarioId: 'edit',
      expectsActions: true,
      spatial: false,
      answers: [gate('gate/needsActions', 'no'), gate('gate/spatial', 'yes')],
    }),
    record({
      scenarioId: 'swap',
      expectsActions: false,
      spatial: true,
      arrangementRules: true,
      stages: [{ stage: 'jevLayout', ms: 5, outcome: 'ok' }],
      answers: [gate('gate/needsActions', 'no'), gate('gate/spatial', 'yes')],
    }),
    record({
      scenarioId: 'big-right',
      expectsActions: false,
      spatial: true,
      arrangementRules: true,
      stages: [{ stage: 'jevActions', ms: 5, outcome: 'deferred' }],
      answers: [gate('gate/needsActions', 'yes'), gate('gate/spatial', 'no')],
    }),
    record({ scenarioId: 'untagged' }),
  ];
  const [summary] = summarize(records);

  test('counts false positives and negatives against the scenario tags', () => {
    expect(summary?.gates).toEqual({
      needsActions: {
        falsePositives: { count: 1, total: 2 },
        falseNegatives: { count: 1, total: 1 },
      },
      spatial: {
        falsePositives: { count: 1, total: 1 },
        falseNegatives: { count: 1, total: 2 },
      },
    });
    expect(summary?.arrangementReachedLayout).toEqual({ count: 1, total: 2 });
  });

  test('renders the gate rows and Jev calls per turn', () => {
    const markdown = renderMarkdown(summarize(records), {});
    expect(markdown).toContain(
      '| needsActions gate false positives / negatives | 1/2 (50.0%) / 1/1 (100.0%) |',
    );
    expect(markdown).toContain(
      '| Spatial gate false positives / negatives | 1/1 (100.0%) / 1/2 (50.0%) |',
    );
    expect(markdown).toContain(
      '| Arrangement turns reaching jevLayout | 1/2 (50.0%) |',
    );
    expect(markdown).toContain('| Jev calls per turn | 0.00 |');
  });

  test('has no gate errors without gate answers', () => {
    expect(summarize([record({})])[0]?.gates).toBe(undefined);
  });
});

describe('renderPaired', () => {
  test('lists every scenario where arms disagree on pass, with failures', () => {
    const paired = renderPaired([
      baseline({ scenarioId: 'same', score: pass }),
      record({ scenarioId: 'same', score: pass }),
      baseline({ scenarioId: 'split', repeat: 2, score: pass }),
      record({
        scenarioId: 'split',
        repeat: 2,
        score: { pass: false, failures: ['Visible instances: expected a'] },
        deferral: {
          stage: 'jevActions',
          reason: 'jevActions/action_unsupported',
          provider: false,
        },
      }),
      baseline({ scenarioId: 'broken', score: pass }),
      record({
        scenarioId: 'broken',
        error: { tag: 'ProviderError', message: 'down' },
      }),
      baseline({ scenarioId: 'expected', expectedDeferral: true }),
      record({ scenarioId: 'expected', expectedDeferral: true }),
    ]);
    expect(paired).toContain('## split #2 (development)');
    expect(paired).toContain('- baseline: pass');
    expect(paired).toContain(
      '- jev: fail (fallback jevActions/action_unsupported)',
    );
    expect(paired).toContain('  - Visible instances: expected a');
    expect(paired).toContain('- jev: error ProviderError: down');
    expect(paired).not.toContain('## same');
    expect(paired).not.toContain('## expected');
    expect(renderPaired([record({ score: pass })])).toContain(
      'No scenario where arms disagree',
    );
  });
});

describe('grader', () => {
  function graded(
    requestSatisfied: number,
    arrangementMatch: number,
  ): RunRecord['grader'] {
    return {
      graderVersion: GRADER_VERSION,
      verbalizerVersion: VERBALIZER_VERSION,
      dimensions: {
        request_satisfied: {
          score: requestSatisfied,
          samples: [requestSatisfied * 4],
        },
        arrangement_match: {
          score: arrangementMatch,
          samples: [arrangementMatch * 4],
        },
      },
      calls: [
        {
          latencyMs: 50,
          outcome: 'ok',
          usage: { inputTokens: 300, outputTokens: 4 },
        },
      ],
    };
  }
  const failed: RunRecord['grader'] = {
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    failure: 'grader/provider_http',
    calls: [{ latencyMs: 5000, outcome: 'provider_timeout' }],
  };
  const records: RunRecord[] = [
    baseline({ scenarioId: 'a', grader: graded(0.5, 0.25) }),
    baseline({ scenarioId: 'b', grader: graded(1, 1) }),
    record({ scenarioId: 'a', grader: graded(1, 0.75) }),
    record({ scenarioId: 'b', grader: graded(0.75, 1) }),
    record({ scenarioId: 'c', grader: failed }),
    record({
      scenarioId: 'd',
      expectedDeferral: true,
      grader: graded(0, 0),
    }),
  ];
  const summaries = summarize(records).filter(
    (summary) => summary.suite === 'development',
  );
  const [baselineSummary, jevSummary] = summaries;

  test('averages each dimension over planned turns and pairs it with the baseline', () => {
    expect(jevSummary?.grader).toEqual({
      graded: 2,
      failed: 1,
      mean: { request_satisfied: 0.875, arrangement_match: 0.875 },
      versusBaseline: {
        request_satisfied: { mean: 0.125, pairs: 2 },
        arrangement_match: { mean: 0.25, pairs: 2 },
      },
      tokens: { calls: 3, input: 600, output: 8, withoutUsage: 1 },
    });
    expect(baselineSummary?.grader?.mean).toEqual({
      request_satisfied: 0.75,
      arrangement_match: 0.625,
    });
    expect(baselineSummary?.grader?.versusBaseline).toBe(undefined);
  });

  test('keeps grader usage out of the arm’s Jev tokens', () => {
    expect(jevSummary?.tokens.jev?.calls).toBe(0);
  });

  test('has no grader summary when no turn was graded', () => {
    expect(summarize([record({})])[0]?.grader).toBe(undefined);
  });

  const passing: GraderValidation = {
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    labels: { total: 18, matched: 18 },
    rho: { request_satisfied: 0.82, arrangement_match: 0.75 },
    gateRho: 0.75,
    meanAbsoluteError: { request_satisfied: 0.1, arrangement_match: 0.2 },
    agreement: { agree: 45, total: 50 },
    passed: true,
  };

  test('shows the grader rows only when validation passed', () => {
    const markdown = renderMarkdown(summaries, {}, passing);
    expect(markdown).toContain('grader: validated (rho=0.75, agreement=90.0%)');
    expect(markdown).toContain(
      '| Grader request_satisfied mean | 0.750 | 0.875 |',
    );
    expect(markdown).toContain(
      '| Grader arrangement_match vs baseline (paired) | n/a | +0.250 (2) |',
    );
    expect(markdown).toContain(
      '| Grader failures | 0/2 (0.0%) | 1/3 (33.3%) |',
    );
    expect(markdown).toContain(
      '| Grader calls / input / output tokens | 2 / 600 / 8 | 3 / 600 / 8 (1 without usage) |',
    );
  });

  test('prints the unvalidated line instead of grader rows when validation failed or did not run', () => {
    for (const validation of [
      { ...passing, passed: false, agreement: { agree: 40, total: 50 } },
      undefined,
    ]) {
      const markdown = renderMarkdown(summaries, {}, validation);
      expect(markdown).not.toContain('Grader request_satisfied');
      expect(markdown).not.toContain('Grader calls');
      expect(markdown).toContain(
        validation
          ? 'grader: unvalidated (rho=0.75, agreement=80.0%)'
          : 'grader: unvalidated (rho=n/a, agreement=n/a)',
      );
    }
  });

  test('says nothing about the grader in a run without it', () => {
    expect(renderMarkdown(summarize([record({})]), {})).not.toContain('grader');
  });
});
