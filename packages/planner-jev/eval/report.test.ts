import { describe, expect, test } from 'bun:test';

import type {
  ComposedAnswers,
  ComposedLayoutRecord,
  RecordedChoice,
  RecordedSize,
} from '../src/lib/stages-experimental/layout-composed.js';
import type { ComposedCandidate } from '../src/lib/stages-experimental/layout-composed-tree.js';
import { GRADER_VERSION } from './grader.js';
import type { GraderValidation } from './grader-validate.js';
import {
  percentile,
  renderMarkdown,
  renderPaired,
  summarize,
} from './report.js';
import type { RunRecord } from './run.js';
import { type Scenario, scenarios } from './scenarios.js';
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

function scenario(id: string): Scenario {
  const found = scenarios.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

function withReferenceTree(
  base: Scenario,
  tree: readonly (string | null)[] | undefined,
): Scenario {
  return { ...base, expected: { ...base.expected, tree } };
}

function choiceAnswer(choice: string): RecordedChoice {
  return { choice, confidence: 1, probabilities: { [choice]: 1 } };
}

function sizeAnswer(): RecordedSize {
  return {
    level: '3',
    score: 2,
    confidence: 1,
    probabilities: { '3': 1 },
    size: 0.5,
  };
}

function composedAnswers(
  shape: string,
  placements: Readonly<Record<string, string>>,
  positions: Readonly<Record<string, string>>,
): ComposedAnswers {
  const ids = Object.keys(placements);
  return {
    shape: choiceAnswer(shape),
    placements: Object.fromEntries(
      ids.map((id) => [id, choiceAnswer(placements[id] as string)]),
    ),
    positions: Object.fromEntries(
      ids.map((id) => [id, choiceAnswer(positions[id] as string)]),
    ),
    sizes: Object.fromEntries(ids.map((id) => [id, sizeAnswer()])),
  };
}

function candidate(
  overrides: Partial<ComposedCandidate> = {},
): ComposedCandidate & { readonly fits: boolean } {
  return {
    tree: [],
    meanProbability: 0.5,
    shape: 'side_by_side_2',
    placements: {},
    positions: {},
    shares: {},
    droppedParts: [],
    addedParts: [],
    fits: true,
    ...overrides,
  };
}

function composition(
  overrides: Partial<ComposedLayoutRecord> = {},
): ComposedLayoutRecord {
  return {
    route: 'spatial',
    called: true,
    nudged: false,
    sizeLevels: 5,
    candidates: [],
    ...overrides,
  };
}

function composed(
  overrides: Partial<RunRecord> & {
    readonly composition: ComposedLayoutRecord;
  },
): RunRecord {
  const { composition: layoutComposition, ...rest } = overrides;
  return record({
    ...rest,
    stageOutputs: {
      jevLayout: { answers: [], composition: layoutComposition },
    },
  });
}

describe('composed layout summary', () => {
  test('counts turns and calls per gating route', () => {
    const records: RunRecord[] = [
      composed({
        scenarioId: 'r1',
        composition: composition({ route: 'spatial', called: true }),
      }),
      composed({
        scenarioId: 'r2',
        composition: composition({ route: 'same_instances', called: false }),
      }),
      composed({
        scenarioId: 'r3',
        composition: composition({ route: 'same_instances', called: true }),
      }),
      composed({
        scenarioId: 'r4',
        composition: composition({ route: 'instances_changed', called: true }),
      }),
    ];
    const [summary] = summarize(records);
    expect(summary?.composed?.turns).toBe(4);
    expect(summary?.composed?.calls).toEqual({ count: 3, total: 4 });
    expect(summary?.composed?.routes.spatial).toEqual({
      turns: { count: 1, total: 4 },
      calls: { count: 1, total: 1 },
    });
    expect(summary?.composed?.routes.same_instances).toEqual({
      turns: { count: 2, total: 4 },
      calls: { count: 1, total: 2 },
    });
    expect(summary?.composed?.routes.instances_changed).toEqual({
      turns: { count: 1, total: 4 },
      calls: { count: 1, total: 1 },
    });
  });

  test('counts the hand-off rate and each cause, over calls that were made', () => {
    const records: RunRecord[] = [
      composed({
        scenarioId: 'r1',
        composition: composition({
          called: true,
          chosen: 0,
          candidates: [candidate()],
        }),
      }),
      composed({
        scenarioId: 'r2',
        composition: composition({ called: true, handOff: 'nothing_fits' }),
      }),
      composed({
        scenarioId: 'r3',
        composition: composition({ called: true, handOff: 'none_of_these' }),
      }),
    ];
    const [summary] = summarize(records);
    expect(summary?.composed?.handOff).toEqual({
      rate: { count: 2, total: 3 },
      byCause: { nothing_fits: 1, none_of_these: 1 },
    });
  });

  test('counts empty-part and added-part repairs, and the chosen candidate rank', () => {
    const records: RunRecord[] = [
      composed({
        scenarioId: 'r1',
        composition: composition({
          chosen: 0,
          candidates: [candidate({ droppedParts: ['part_2'] })],
        }),
      }),
      composed({
        scenarioId: 'r2',
        composition: composition({
          chosen: 1,
          candidates: [candidate(), candidate({ addedParts: ['part_3'] })],
        }),
      }),
      composed({
        scenarioId: 'r3',
        composition: composition({ handOff: 'nothing_fits' }),
      }),
    ];
    const [summary] = summarize(records);
    expect(summary?.composed?.repairs).toEqual({
      droppedParts: { count: 1, total: 2 },
      addedParts: { count: 1, total: 2 },
    });
    expect(summary?.composed?.chosenIndex).toEqual({
      counts: [1, 1],
      total: 2,
    });
  });

  test('attributes a wrong shape answer to shape', () => {
    const swap = withReferenceTree(scenario('swap'), [
      'V',
      'ID:calendar-main',
      'ID:map-main',
    ]);
    const records: RunRecord[] = [
      composed({
        scenarioId: swap.id,
        score: { ...fail, arrangement: fail },
        composition: composition({
          answers: composedAnswers(
            'stacked_2',
            { 'calendar-main': 'part_1', 'map-main': 'part_2' },
            { 'calendar-main': 'first', 'map-main': 'first' },
          ),
        }),
      }),
    ];
    const [summary] = summarize(records, [swap]);
    expect(summary?.composed?.attribution).toEqual({
      attributed: { count: 1, total: 1 },
      byQuestion: { shape: 1, placement: 0, position: 0, size: 0 },
    });
  });

  test('attributes a wrong placement answer when the shape matches', () => {
    const swap = withReferenceTree(scenario('swap'), [
      'V',
      'ID:calendar-main',
      'ID:map-main',
    ]);
    const records: RunRecord[] = [
      composed({
        scenarioId: swap.id,
        score: { ...fail, arrangement: fail },
        composition: composition({
          answers: composedAnswers(
            'side_by_side_2',
            { 'calendar-main': 'part_1', 'map-main': 'part_1' },
            { 'calendar-main': 'first', 'map-main': 'first' },
          ),
        }),
      }),
    ];
    const [summary] = summarize(records, [swap]);
    expect(summary?.composed?.attribution.byQuestion).toEqual({
      shape: 0,
      placement: 1,
      position: 0,
      size: 0,
    });
  });

  test('attributes a wrong position answer when shape and placement match', () => {
    const topAndPair = withReferenceTree(scenario('top-and-pair'), [
      'V',
      'H',
      'ID:weather-main',
      'ID:map-main',
      'ID:calendar-main',
    ]);
    const records: RunRecord[] = [
      composed({
        scenarioId: topAndPair.id,
        score: { ...fail, arrangement: fail },
        composition: composition({
          answers: composedAnswers(
            'side_by_side_2',
            {
              'weather-main': 'part_1',
              'map-main': 'part_1',
              'calendar-main': 'part_2',
            },
            {
              'weather-main': 'first',
              'map-main': 'first',
              'calendar-main': 'first',
            },
          ),
        }),
      }),
    ];
    const [summary] = summarize(records, [topAndPair]);
    expect(summary?.composed?.attribution.byQuestion).toEqual({
      shape: 0,
      placement: 0,
      position: 1,
      size: 0,
    });
  });

  test('attributes size by elimination when shape, placement and position all match', () => {
    const topAndPair = withReferenceTree(scenario('top-and-pair'), [
      'V',
      'H',
      'ID:weather-main',
      'ID:map-main',
      'ID:calendar-main',
    ]);
    const records: RunRecord[] = [
      composed({
        scenarioId: topAndPair.id,
        score: { ...fail, arrangement: fail },
        composition: composition({
          answers: composedAnswers(
            'side_by_side_2',
            {
              'weather-main': 'part_1',
              'map-main': 'part_1',
              'calendar-main': 'part_2',
            },
            {
              'weather-main': 'first',
              'map-main': 'second',
              'calendar-main': 'first',
            },
          ),
        }),
      }),
    ];
    const [summary] = summarize(records, [topAndPair]);
    expect(summary?.composed?.attribution.byQuestion).toEqual({
      shape: 0,
      placement: 0,
      position: 0,
      size: 1,
    });
  });

  test('leaves out turns with no reference tree, a passing arrangement, or no Jev call', () => {
    const swap = scenario('swap');
    const noTree = withReferenceTree(scenario('big-right'), undefined);
    const records: RunRecord[] = [
      composed({
        scenarioId: swap.id,
        score: pass,
        composition: composition({
          answers: composedAnswers(
            'stacked_2',
            { 'calendar-main': 'part_1', 'map-main': 'part_2' },
            { 'calendar-main': 'first', 'map-main': 'first' },
          ),
        }),
      }),
      composed({
        scenarioId: noTree.id,
        score: { ...fail, arrangement: fail },
        composition: composition({
          answers: composedAnswers(
            'stacked_2',
            { 'calendar-main': 'part_1', 'map-main': 'part_2' },
            { 'calendar-main': 'first', 'map-main': 'first' },
          ),
        }),
      }),
      composed({
        scenarioId: swap.id,
        score: { ...fail, arrangement: fail },
        composition: composition({ called: false, answers: undefined }),
      }),
    ];
    const [summary] = summarize(records, [swap, noTree]);
    expect(summary?.composed?.attribution.attributed).toEqual({
      count: 0,
      total: 0,
    });
  });

  test('reports the ratio of nudged turns that kept the pre-existing Instances’ order', () => {
    const topAndPair = scenario('top-and-pair');
    const records: RunRecord[] = [
      composed({
        scenarioId: topAndPair.id,
        tree: [
          'V:1,1,1,1',
          'ID:calendar-main',
          'ID:journal-main',
          'ID:weather-main',
          'ID:map-main',
        ],
        composition: composition({ nudged: true }),
      }),
      composed({
        scenarioId: topAndPair.id,
        tree: ['V:1,1,1', 'ID:map-main', 'ID:weather-main', 'ID:calendar-main'],
        composition: composition({ nudged: true }),
      }),
    ];
    const [summary] = summarize(records, [topAndPair]);
    expect(summary?.composed?.nudgedOrderKept).toEqual({
      derivable: true,
      ratio: { count: 1, total: 2 },
    });
  });

  test('reports not derivable without a joined scenario', () => {
    const records: RunRecord[] = [
      composed({
        scenarioId: 'top-and-pair',
        tree: ['ID:calendar-main'],
        composition: composition({ nudged: true }),
      }),
    ];
    const [summary] = summarize(records);
    const kept = summary?.composed?.nudgedOrderKept;
    expect(kept?.derivable).toBe(false);
  });

  test('omits the composed rows entirely when no arm recorded a composition', () => {
    const markdown = renderMarkdown(summarize([record({}), baseline({})]), {});
    expect(markdown).not.toContain('Composed');
  });

  test('renders n/a for an arm with no composition when another arm has one', () => {
    const records: RunRecord[] = [
      composed({
        scenarioId: 'r1',
        composition: composition({ route: 'spatial' }),
      }),
      baseline({ scenarioId: 'r1' }),
    ];
    const markdown = renderMarkdown(summarize(records), {});
    expect(markdown).toContain('| Composed layout turns | 1 | n/a |');
    expect(markdown).toContain(
      '| Composed route: spatial | 1/1 (100.0%) | n/a |',
    );
  });
});
