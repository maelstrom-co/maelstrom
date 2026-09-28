import { describe, expect, test } from 'bun:test';

import {
  fakePluginWith,
  TOKYO_CANDIDATE,
} from './__test-helpers__/fake-planner.js';
import { GRADER_VERSION } from './grader.js';
import type { GraderValidation } from './grader-validate.js';
import { renderMarkdown, renderPaired, summarize } from './report.js';
import type { RunRecord } from './run.js';
import { percentile } from './stats.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

const plugins = [fakePluginWith({ candidate: () => TOKYO_CANDIDATE })];

const pass = { pass: true, failures: [] };
const fail = { pass: false, failures: ['x'] };

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    scenarioId: 's',
    suite: 'development',
    arm: 'fake',
    kind: 'fake',
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
      picked: ['a', 'b'],
    }),
    record({
      scenarioId: 'b',
      score: fail,
      turnMs: 300,
      fallbackCalls: 1,
      deferral: {
        stage: 'write',
        reason: 'write/layout_unavailable',
        provider: false,
      },
    }),
    record({
      scenarioId: 'c',
      score: pass,
      turnMs: 200,
      fallbackCalls: 1,
      deferral: {
        stage: 'pick',
        reason: 'pick/provider_timeout',
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
      fakeCalls: [
        {
          stage: 'pick',
          latencyMs: 40,
          usage: { inputTokens: 10, outputTokens: 1 },
        },
        {
          stage: 'write',
          latencyMs: 60,
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
        { stage: 'pick', ms: 45, outcome: 'ok' },
        { stage: 'write', ms: 5, outcome: 'ok', replayed: true },
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
  const summaries = summarize(records, plugins);
  const jev = summaries.find((s) => s.arm === 'fake' && s.suite === 'all');
  const base = summaries.find((s) => s.arm === 'baseline' && s.suite === 'all');

  test('excludes expected deferrals from every arm’s overall pass rate', () => {
    expect(jev?.overall).toEqual({ count: 3, total: 6 });
    expect(jev?.expectedDeferrals).toEqual({ count: 1, total: 1 });
    expect(base?.overall).toEqual({ count: 1, total: 3 });
  });

  test('lists fallbacks by full reason, with the by-stage split kept', () => {
    expect(jev?.fallbacks?.total).toEqual({ count: 3, total: 7 });
    expect(jev?.fallbacks?.byReason).toEqual({
      'write/layout_unavailable': 1,
      'pick/provider_timeout': 1,
    });
    expect(jev?.fallbacks?.byStage).toEqual({ write: 1 });
    expect(jev?.fallbacks?.providerByStage).toEqual({ pick: 1 });
  });

  test('reports live stage latency per plugin stage, replayed stages and the plugin summary fields', () => {
    expect(jev?.latency.turn.p50).toBe(100);
    expect(jev?.latency.stages?.pick?.p50).toBe(45);
    expect(jev?.latency.stages?.write?.samples).toBe(0);
    expect(Object.keys(jev?.latency.stages ?? {})).toEqual(['pick', 'write']);
    expect(jev?.replayed).toEqual(['write']);
    expect(jev?.picks).toBe(2);
    expect(jev?.latency.fakeCall).toEqual({ p50: 40, p95: 60, samples: 2 });
    expect(jev?.tokens.fake).toEqual({
      calls: 2,
      input: 15,
      output: 2,
      withoutUsage: 0,
    });
    expect(base?.picks).toBe(undefined);
    expect(base?.latency.stages).toBe(undefined);
    expect(base?.tokens.fake).toBe(undefined);
  });

  test('scores arrangement only over scenarios that declare rules', () => {
    expect(jev?.arrangement).toEqual({ count: 1, total: 2 });
    expect(base?.arrangement).toEqual({ count: 0, total: 1 });
    expect(jev?.spatial).toEqual({ spatial: 1, controls: 0 });
  });

  test('counts every planned turn on a ruled scenario, an unscored one as a failure', () => {
    const [ruled] = summarize(
      [
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
      ],
      plugins,
    );
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
    const markdown = renderMarkdown(
      summaries,
      {
        repeats: 1,
        replay: { from: '/tmp/run', through: 'actions', arm: 'jev-poc' },
      },
      { plugins },
    );
    expect(markdown).toContain('| Metric | fake | baseline |');
    expect(markdown).toContain(
      '- replay: {"from":"/tmp/run","through":"actions","arm":"jev-poc"}',
    );
    expect(markdown).toContain('| Overall pass | 3/6 (50.0%) | 1/3 (33.3%) |');
    expect(markdown).toContain(
      '| Arrangement pass | 1/2 (50.0%) | 0/1 (0.0%) |',
    );
    expect(markdown).toContain(
      '| Fallbacks: write/layout_unavailable | 1 | n/a |',
    );
    expect(markdown).toContain('| Decisive turns pass | 2/4 (50.0%) | n/a |');
    expect(markdown).toContain(
      '| Decisive wins / losses vs baseline (paired) | 2 / 1 (3) | n/a |',
    );
    expect(markdown).toContain('| Fake picks | 2 | n/a |');
    expect(markdown).toContain(
      '| write latency p50 / p95 (ms) | replayed | n/a |',
    );
    expect(markdown).toContain(
      '| LLM calls / input / output tokens | 1 / 900 / 40 | 2 / 3000 / 500 (1 without usage) |',
    );
    expect(markdown).toContain(
      '| LLM planner calls / input / output tokens | 0 / 0 / 0 | 2 / 3000 / 500 (1 without usage) |',
    );
    expect(markdown).toContain(
      '| Fake calls / input / output tokens | 2 / 15 / 2 | n/a |',
    );
    expect(markdown).not.toContain('Spatial gate');
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
          stage: 'write',
          reason: 'write/action_unsupported',
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
      '- fake: fail (fallback write/action_unsupported)',
    );
    expect(paired).toContain('  - Visible instances: expected a');
    expect(paired).toContain('- fake: error ProviderError: down');
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
  const summaries = summarize(records, plugins).filter(
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

  test('keeps grader usage out of the arm’s own provider tokens', () => {
    expect((jevSummary?.tokens.fake as { calls: number }).calls).toBe(0);
  });

  test('has no grader summary when no turn was graded', () => {
    expect(summarize([record({})], plugins)[0]?.grader).toBe(undefined);
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
    const markdown = renderMarkdown(
      summaries,
      {},
      {
        plugins,
        graderValidation: passing,
      },
    );
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
      const markdown = renderMarkdown(
        summaries,
        {},
        {
          plugins,
          graderValidation: validation,
        },
      );
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
    expect(
      renderMarkdown(summarize([record({})], plugins), {}, { plugins }),
    ).not.toContain('grader');
  });
});

describe('plugin summary fields', () => {
  const [fake] = plugins;
  if (!fake) throw new Error('fake plugin is missing');
  test.each([
    [{ overall: 1 }, 'overall in an arm summary'],
    [{ grader: {} }, 'grader in an arm summary'],
    [{ latency: { turn: 1 } }, 'turn in an arm summary latency'],
    [{ tokens: { llm: 1 } }, 'llm in an arm summary tokens'],
  ])('refuses %o, a field the runner owns', (extension, where) => {
    const clobbering = { ...fake, summarizeArm: () => extension };
    expect(() => summarize([record({})], [clobbering])).toThrow(
      `plugin fake sets ${where}, which the runner owns`,
    );
  });
});
