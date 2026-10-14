import { describe, expect, test } from 'bun:test';

import { GRADER_VERSION } from '../../core/grader.js';
import { renderMarkdown, summarize } from '../../core/report.js';
import type { RunRecord } from '../../core/run.js';
import { VERBALIZER_VERSION } from '../../core/verbalize-tree.js';
import { llmPlugin } from '../llm/plugin.js';
import { jevPlugin } from './plugin.js';
import type { JevRunRecord } from './record.js';
import type { JevArmSummary } from './report.js';

const plugins = [llmPlugin, jevPlugin];
const pass = { pass: true, failures: [] };
const fail = { pass: false, failures: ['x'] };

function record(overrides: Partial<JevRunRecord>): RunRecord {
  return {
    scenarioId: 's',
    suite: 'development',
    arm: 'jev-poc',
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

const jevOf = (records: readonly RunRecord[], suite = 'all') =>
  summarize(records, plugins).find(
    (s) => s.arm === 'jev-poc' && s.suite === suite,
  ) as JevArmSummary | undefined;

describe('the Jev summary fields', () => {
  const records: RunRecord[] = [
    record({
      scenarioId: 'a',
      score: pass,
      stageScores: { selection: pass, actions: pass, layout: pass },
    }),
    record({
      scenarioId: 'b',
      score: fail,
      fallbackCalls: 1,
      deferral: {
        stage: 'jevLayout',
        reason: 'jevLayout/layout_unavailable',
        provider: false,
      },
      stageScores: { selection: pass, actions: fail },
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
      stages: [
        { stage: 'jevSelect', ms: 45, outcome: 'ok' },
        { stage: 'jevActions', ms: 5, outcome: 'ok', replayed: true },
      ],
    }),
    record({
      scenarioId: 'g',
      arrangementRules: true,
      score: { ...fail, arrangement: fail },
      spatial: true,
    }),
    baseline({ scenarioId: 'a', score: fail }),
  ];
  const jev = jevOf(records);

  test('reports stage accuracy, fill rate, live latency and Jev tokens', () => {
    expect(jev?.stages).toEqual({
      selection: { count: 2, total: 2 },
      actions: { count: 1, total: 2 },
      layout: { count: 1, total: 1 },
    });
    expect(jev?.fill).toEqual({ count: 1, total: 2 });
    expect(jev?.latency.jevCall).toEqual({ p50: 40, p95: 60, samples: 2 });
    expect(jev?.latency.stages?.jevSelect?.p50).toBe(45);
    expect(jev?.latency.stages?.jevActions?.samples).toBe(0);
    expect(Object.keys(jev?.latency.stages ?? {})).toEqual([
      'jevSelect',
      'jevActions',
      'jevLayout',
      'llmComplete',
    ]);
    expect(jev?.replayed).toEqual(['jevActions']);
    expect(jev?.tokens.jev).toEqual({
      calls: 2,
      input: 15,
      output: 2,
      withoutUsage: 0,
      perTurn: { input: 15 / 4, output: 2 / 4 },
    });
    expect(jev?.arrangementReachedLayout).toEqual({ count: 0, total: 1 });
  });

  test('renders the Jev rows in the report, n/a for the baseline', () => {
    const markdown = renderMarkdown(
      summarize(records, plugins),
      {},
      { plugins },
    );
    expect(markdown).toContain('| Selection accuracy | 2/2 (100.0%) | n/a |');
    expect(markdown).toContain('| llmComplete fill rate | 1/2 (50.0%) | n/a |');
    expect(markdown).toContain(
      '| jevActions latency p50 / p95 (ms) | replayed | n/a |',
    );
    expect(markdown).toContain(
      '| Stage tokens per turn (input / output) | 3.8 / 0.5 | n/a |',
    );
    expect(markdown).toContain(
      '| Spatial gate false positives / negatives | n/a (1 spatial, 0 controls) | n/a (0 spatial, 0 controls) |',
    );
    expect(markdown).toContain(
      '| Fallbacks: jevLayout/layout_unavailable | 1 | n/a |',
    );
  });

  test('keeps the same summary keys for a Jev arm as before the plugin seam', () => {
    expect(Object.keys(jev ?? {}).sort()).toEqual([
      'arm',
      'arrangement',
      'arrangementReachedLayout',
      'decisive',
      'errors',
      'expectedDeferrals',
      'fallbacks',
      'fill',
      'kind',
      'latency',
      'overall',
      'replayed',
      'runs',
      'spatial',
      'stages',
      'suite',
      'tokens',
    ]);
    expect(Object.keys(jev?.latency ?? {}).sort()).toEqual([
      'jevCall',
      'llmCall',
      'stages',
      'turn',
    ]);
    expect(Object.keys(jev?.tokens ?? {}).sort()).toEqual(['jev', 'llm']);
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
  const summary = jevOf(records, 'development');

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

  test('renders the gate rows and stage calls per turn', () => {
    const markdown = renderMarkdown(
      summarize(records, plugins),
      {},
      { plugins },
    );
    expect(markdown).toContain(
      '| needsActions gate false positives / negatives | 1/2 (50.0%) / 1/1 (100.0%) |',
    );
    expect(markdown).toContain(
      '| Spatial gate false positives / negatives | 1/1 (100.0%) / 1/2 (50.0%) |',
    );
    expect(markdown).toContain(
      '| Arrangement turns reaching jevLayout | 1/2 (50.0%) |',
    );
    expect(markdown).toContain('| Stage calls per turn | 0.00 |');
  });

  test('decides each gate from its own threshold, not the raw pick', () => {
    const answered = (
      question: string,
      choice: 'yes' | 'no',
      probability: number,
    ) => ({ ...gate(question, choice), probability });
    const summary = jevOf([
      record({
        scenarioId: 'route',
        expectsActions: true,
        spatial: true,
        answers: [
          answered('gate/needsActions', 'no', 0.6),
          answered('gate/spatial', 'no', 0.6),
        ],
      }),
    ]);
    expect(summary?.gates).toEqual({
      needsActions: {
        falsePositives: { count: 0, total: 0 },
        falseNegatives: { count: 0, total: 1 },
      },
      spatial: {
        falsePositives: { count: 0, total: 0 },
        falseNegatives: { count: 1, total: 1 },
      },
    });
  });

  test('has no gate errors without gate answers', () => {
    expect(jevOf([record({})])?.gates).toBe(undefined);
  });
});

describe('grader usage', () => {
  test('stays out of the arm’s stage tokens', () => {
    const summary = jevOf([
      record({
        scenarioId: 'a',
        grader: {
          graderVersion: GRADER_VERSION,
          verbalizerVersion: VERBALIZER_VERSION,
          dimensions: {
            request_satisfied: { score: 1, samples: [4] },
            arrangement_match: { score: 1, samples: [4] },
          },
          calls: [
            {
              latencyMs: 50,
              outcome: 'ok',
              usage: { inputTokens: 300, outputTokens: 4 },
            },
          ],
        },
      }),
    ]);
    expect(summary?.tokens.jev?.calls).toBe(0);
    expect(summary?.grader?.tokens.calls).toBe(1);
  });
});
