import { expect, test } from 'bun:test';
import {
  type EvaluationAdapter,
  type EvaluationContext,
  evaluateSample,
} from './evaluate.js';
import { sessionAdapter } from './session.js';

const identity = {
  runId: 'run',
  caseId: 'case',
  runtimeId: 'script',
  sample: 1,
};
const good: EvaluationAdapter<{ count?: number }> = {
  surface: 'operation',
  provenance: 'scripted',
  execute: async () => ({
    completeness: 'complete',
    disposition: 'planned',
    value: {},
  }),
  score: () => ({ outcome: 'pass', failures: [] }),
};

test('missing evidence never passes or invokes scoring; unknown counters remain absent', async () => {
  for (const completeness of ['partial', 'absent'] as const) {
    const result = await evaluateSample<{ count?: number }>(identity, {
      ...good,
      execute: async () => ({
        completeness,
        disposition: 'planned',
        value: {},
      }),
      score: () => {
        throw new Error('must not score');
      },
    });
    expect(result.evaluation).toBe('unscored');
    expect(result.error).toBeUndefined();
    expect(result.observation?.count).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  }
  const zero = await evaluateSample(identity, {
    ...good,
    execute: async () => ({
      completeness: 'complete',
      disposition: 'planned',
      value: { count: 0 },
    }),
  });
  expect(zero.observation?.count).toBe(0);
});

test('preflight, execution, scoring and cleanup failures remain distinct', async () => {
  let ran = 0;
  let disposed = 0;
  const invalid = await evaluateSample(identity, {
    ...good,
    preflight: () => {
      throw new Error('bad input');
    },
    execute: async (context) => {
      ran++;
      return good.execute(context);
    },
    dispose: () => {
      disposed++;
    },
  });
  expect(invalid.execution).toBe('invalid');
  expect(invalid.error?.phase).toBe('preflight');
  expect(ran).toBe(0);
  expect(disposed).toBe(0);
  const failed = await evaluateSample(identity, {
    ...good,
    execute: async (context) => {
      context.record({ kind: 'turn', value: { completed: true } });
      throw new Error('runtime');
    },
    dispose: () => {
      disposed++;
    },
  });
  expect(failed).toMatchObject({
    execution: 'error',
    evaluation: 'unscored',
    completeness: 'partial',
    error: { phase: 'execution' },
  });
  expect(failed.records).toHaveLength(1);
  expect(disposed).toBe(1);
  const scorer = await evaluateSample(identity, {
    ...good,
    score: () => {
      throw new Error('oracle');
    },
    dispose: () => {
      throw new Error('cleanup');
    },
  });
  expect(scorer).toMatchObject({
    execution: 'completed',
    evaluation: 'unscored',
    completeness: 'complete',
    error: { phase: 'scoring' },
    cleanupError: 'cleanup',
  });
});

test('hand-off, applicability and an expected deferral are separate outcomes', async () => {
  for (const disposition of [
    'handed_off',
    'not_applicable',
    'deferred',
  ] as const) {
    const result = await evaluateSample(identity, {
      ...good,
      execute: async () => ({
        completeness: 'complete',
        disposition,
        value: {},
      }),
    });
    expect(result.disposition).toBe(disposition);
    expect(result.evaluation).toBe(
      disposition === 'not_applicable'
        ? 'not_applicable'
        : disposition === 'handed_off'
          ? 'unscored'
          : 'pass',
    );
  }
});

test('concurrent identical request IDs stay scoped to sample and producer; final evidence is snapshotted', async () => {
  const gate = Promise.withResolvers<void>();
  let late: EvaluationContext | undefined;
  const value = { count: 1 };
  const first = evaluateSample(identity, {
    ...good,
    execute: async (context) => {
      late = context;
      context.record({
        kind: 'diagnostic',
        producer: 'one',
        requestId: 'same',
        value,
      });
      await gate.promise;
      return { completeness: 'complete', disposition: 'planned', value };
    },
  });
  const second = await evaluateSample(
    { ...identity, sample: 2 },
    {
      ...good,
      execute: async (context) => {
        context.record({
          kind: 'diagnostic',
          producer: 'two',
          requestId: 'same',
          value,
        });
        gate.resolve();
        return { completeness: 'complete', disposition: 'planned', value };
      },
    },
  );
  const result = await first;
  value.count = 99;
  expect(result.records[0].sampleKey).not.toBe(second.records[0].sampleKey);
  expect(result.records[0].value).toEqual({ count: 1 });
  expect(result.observation).toEqual({ count: 1 });
  expect(() => late?.record({ kind: 'turn', value: 'late' })).toThrow(
    'finalized',
  );
});

test('session copies mutable state/history and resets each invocation, preserving completed turns on failure', async () => {
  const initial = { count: 0 };
  const adapter = sessionAdapter({
    provenance: 'scripted',
    inputs: [1, 2],
    initialize: () => initial,
    async step(input, state, history) {
      expect(state.count).toBe(history.length);
      state.count++;
      return { state, output: input };
    },
    score: (turns) => ({
      outcome: turns.length === 2 ? 'pass' : 'fail',
      failures: [],
    }),
  });
  for (const sample of [1, 2]) {
    const result = await evaluateSample({ ...identity, sample }, adapter);
    expect(result.evaluation).toBe('pass');
    expect(result.observation?.map((turn) => turn.state.count)).toEqual([0, 1]);
    expect(
      result.observation?.map((turn) => turn.resultingState.count),
    ).toEqual([1, 2]);
  }
  expect(initial.count).toBe(0);

  let retained: { count: number } | undefined;
  const failing = sessionAdapter({
    provenance: 'scripted',
    inputs: [1, 2],
    initialize: () => initial,
    async step(input, state, history) {
      if (input === 2) {
        state.count = 99;
        if (retained) retained.count = 99;
        if (history[0]) history[0].resultingState.count = 99;
        throw new Error('second turn failed');
      }
      state.count++;
      retained = state;
      return { state, output: input };
    },
    score: () => {
      throw new Error('must not score incomplete session');
    },
  });
  const failed = await evaluateSample(identity, failing);
  expect(failed).toMatchObject({
    execution: 'error',
    evaluation: 'unscored',
    completeness: 'partial',
    error: { phase: 'execution', message: 'second turn failed' },
  });
  expect(failed.observation).toBeUndefined();
  expect(failed.records).toEqual([
    {
      sampleKey: failed.sampleKey,
      sequence: 0,
      kind: 'turn',
      value: {
        index: 0,
        state: { count: 0 },
        resultingState: { count: 1 },
        input: 1,
        output: 1,
      },
    },
  ]);
  expect(initial.count).toBe(0);
});

test('invalid sample identities are rejected before initialization', async () => {
  for (const sample of [0, -1, 1.5, Number.NaN])
    await expect(evaluateSample({ ...identity, sample }, good)).rejects.toThrow(
      'positive integer',
    );
});
