import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { evaluateSample } from '../core/runtime/evaluate.js';
import { manualJudge } from './judge.js';

const identity = {
  runId: 'manual',
  caseId: 'case',
  runtimeId: 'scripted',
  sample: 1,
};
const definition = {
  inputs: { intent: 'say hello' },
  expectations: { exactText: 'hello' },
};

test('manual env opt-in judges actual evidence and reports calls separately from planner dispatches', async () => {
  const judging = manualJudge(
    definition,
    {
      MAELSTROM_ENABLE_LLM_JUDGE: 'true',
      MAELSTROM_LLM_JUDGE_PROVIDER: 'heuristic',
    },
    {},
  );
  let dispatches = 0;
  const result = await evaluateSample(identity, {
    ...(judging.judge && { judge: judging.judge }),
    surface: 'session',
    provenance: 'synthetic',
    async execute() {
      dispatches++;
      return {
        completeness: 'complete',
        disposition: 'planned',
        value: [{ response: { userMessage: 'hello' } }],
      };
    },
    score() {
      return { outcome: 'fail', failures: ['independent'] };
    },
  });
  expect(result.judge).toMatchObject({
    status: 'scored',
    provenance: { kind: 'heuristic' },
    scores: [{ name: 'llm_judge_score', value: 1 }],
  });
  expect(result.evaluation).toBe('fail');
  expect(dispatches).toBe(1);
  expect(judging.calls).toEqual({
    attempts: 1,
    reportedCalls: 0,
    unknownAttempts: 0,
  });
});

test('manual explicit provider rates retained partial evidence once; missing output does not manufacture a call', async () => {
  let asked = 0;
  const judging = manualJudge(
    definition,
    {},
    {
      judge: {
        provenance: { kind: 'llm', provider: 'fake', model: 'fake' },
        async score(input) {
          asked++;
          expect(input.state.observation).toHaveLength(1);
          expect(input.state.completeness).toBe('partial');
          return {
            answers: { session_alignment: { score: 2, probabilities: {} } },
            calls: [{ latencyMs: 1 }],
          };
        },
      },
    },
  );
  const run = (output: unknown[]) =>
    evaluateSample(identity, {
      ...(judging.judge && { judge: judging.judge }),
      surface: 'session',
      provenance: 'synthetic',
      async execute() {
        return {
          completeness: output.length ? 'partial' : 'absent',
          disposition: 'planned',
          value: output,
          error: 'Interrupted',
        };
      },
      score() {
        throw new Error('Incomplete output must not score');
      },
    });
  const result = await run([{ response: { userMessage: 'hello' } }]);
  expect(result.judge?.status).toBe('scored');
  expect(result.evaluation).toBe('unscored');
  expect((await run([])).judge).toMatchObject({
    status: 'not_run',
    reason: 'no_valid_evidence',
  });
  expect(asked).toBe(1);
  expect(judging.calls).toEqual({
    attempts: 1,
    reportedCalls: 1,
    unknownAttempts: 0,
  });
});

test('manual disabled and invalid config are resolved before any planner work; every probe installs the hook after dry-run', () => {
  expect(
    manualJudge(
      definition,
      {
        MAELSTROM_ENABLE_LLM_JUDGE: 'true',
        MAELSTROM_LLM_JUDGE_PROVIDER: 'bad',
      },
      { configuration: { enabled: false } },
    ).judge,
  ).toBeUndefined();
  expect(() =>
    manualJudge(
      definition,
      {
        MAELSTROM_ENABLE_LLM_JUDGE: 'true',
        MAELSTROM_LLM_JUDGE_PROVIDER: 'bad',
      },
      {},
    ),
  ).toThrow();
  for (const probe of ['d02', 'd14', 'd17', 'd25', 'd33', 'd35', 'weather']) {
    const source = readFileSync(
      new URL(`./${probe}.ts`, import.meta.url),
      'utf8',
    );
    expect(source.indexOf("mode: 'dry-run'")).toBeLessThan(
      source.indexOf('manualJudge(value, env, judgingOptions)'),
    );
    expect(
      source.indexOf('manualJudge(value, env, judgingOptions)'),
    ).toBeLessThan(source.indexOf('const transport = manualTransport('));
    expect(source).toContain('judge: judging.judge');
    expect(source).toContain('judgeCalls: { ...judging.calls }');
    expect(source).toContain('generationDispatches: transport.count()');
  }
});
