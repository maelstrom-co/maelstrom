import { expect, test } from 'bun:test';
import { ok } from '@maelstrom-co/protocol';
import { evaluateSample } from '../core/runtime/evaluate.js';
import { selectScenarios } from '../core/scenarios.js';
import { registerStageEval, type StageEvalModule } from '../core/stage-eval.js';
import { stageAdapter } from './stage.js';

const calls = [{ latencyMs: 2, usage: { inputTokens: 3, outputTokens: 0 } }];
const module: StageEvalModule<
  { id: string },
  { steps: string[] },
  { count: number },
  { record: () => void }
> = {
  name: 'scripted',
  stage: 'scripted',
  variants: {
    normal: (deps) => async () => {
      deps.record();
      await Promise.resolve();
      return ok({ steps: ['completed'] });
    },
    broken: (deps) => async () => {
      deps.record();
      throw new Error('runtime failed');
    },
  },
  makeDeps: (onCall) => ({ record: () => onCall(structuredClone(calls[0])) }),
  prepare: async (scenario, context) => ({
    applicable: true,
    input: { id: scenario.id },
    origin: context.origin,
  }),
  judge: (scenario, input, output) => {
    if (scenario.id === 'preserve') {
      input.id = 'mutated-by-judge';
      output.steps.push('mutated-by-judge');
      throw new Error('judge failed');
    }
    return {
      outcome: 'pass',
      failures: [],
      detail: { count: output.steps.length },
    };
  },
};
const registered = registerStageEval(module);

function scenario(id: string) {
  const value = selectScenarios('all', [id])[0];
  if (!value) throw new Error(`Unknown test scenario ${id}`);
  return value;
}

function run(id: string, variant = 'normal') {
  return evaluateSample(
    { runId: 'offline', caseId: id, runtimeId: 'scripted', sample: 1 },
    stageAdapter({
      module: registered,
      scenario: scenario(id),
      variant,
      provenance: 'scripted',
    }),
  );
}

test('a throwing stage judge is a scoring error with completed evidence and calls retained', async () => {
  const result = await run('preserve');
  expect(result).toMatchObject({
    execution: 'completed',
    evaluation: 'unscored',
    completeness: 'complete',
    disposition: 'planned',
    error: { phase: 'scoring', message: 'judge failed' },
  });
  expect(result.observation?.calls).toEqual(calls);
  expect(result.observation?.stageMs).toBeGreaterThanOrEqual(0);
  expect(result.observation?.judgeFailure).toEqual({
    message: 'judge failed',
    input: { id: 'preserve' },
    output: { steps: ['completed'] },
  });
  expect(result.records).toEqual([
    {
      sampleKey: result.sampleKey,
      sequence: 0,
      kind: 'stage',
      value: result.observation,
    },
  ]);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

test('judge failures do not leak across concurrent samples sharing a registered module', async () => {
  const [failed, passed] = await Promise.all([run('preserve'), run('swap')]);
  expect(failed.error?.phase).toBe('scoring');
  expect(passed).toMatchObject({
    execution: 'completed',
    evaluation: 'pass',
    completeness: 'complete',
  });
  expect(passed.error).toBeUndefined();
  expect(passed.observation?.judgeFailure).toBeUndefined();
  expect(passed.observation?.detail).toEqual({ count: 1 });
  expect(passed.observation?.calls).toEqual(calls);
  expect(failed.records[0].sampleKey).not.toBe(passed.records[0].sampleKey);
});

test('stage execution failures remain execution errors rather than judge failures', async () => {
  const result = await run('swap', 'broken');
  expect(result).toMatchObject({
    execution: 'error',
    evaluation: 'unscored',
    completeness: 'partial',
    error: { phase: 'execution', message: 'runtime failed' },
  });
  expect(result.observation?.judgeFailure).toBeUndefined();
  expect(result.observation?.calls).toEqual(calls);
});

test('ordinary stage runs still propagate judge exceptions unless capture is requested', async () => {
  await expect(
    registered.run({
      scenarios: [scenario('preserve')],
      variants: ['normal'],
      repeats: 1,
    }),
  ).rejects.toThrow('judge failed');
});
