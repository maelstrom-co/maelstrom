import { expect, test } from 'bun:test';
import {
  runEvaluationRun,
  selectEvaluationCases,
} from './run-orchestration.js';
import type { EvaluationAdapter } from './runtime/evaluate.js';

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const adapter = (value: string): EvaluationAdapter<string> => ({
  surface: 'synthetic',
  provenance: 'synthetic',
  execute: async () => ({
    completeness: 'complete',
    disposition: 'planned',
    value,
  }),
  score: () => ({ outcome: 'pass', failures: [] }),
});

const basic = {
  runId: 'test-run',
  policy: 'synthetic:contract/v1',
  cases: ['a', 'b'],
  runtimes: ['one', 'two'],
  repeats: 2,
  caseId: (value: string) => value,
  runtimeId: (_value: string, runtime: string) => runtime,
  prepare: (value: string) => value,
  invocation: (
    value: string,
    _prepared: string,
    runtime: string,
    identity: { sample: number },
  ) => ({
    adapter: adapter(`${value}/${identity.sample}/${runtime}`),
    finish: (result: { observation?: string }) =>
      result.observation ?? 'missing',
  }),
};

const catalog = [
  { id: 'a', suite: 'dev' },
  { id: 'b', suite: 'held' },
  { id: 'c', suite: 'dev' },
];
const selection = { id: (x: (typeof catalog)[number]) => x.id };

test('selection preserves catalog order and deduplicates requested IDs', () => {
  expect(
    selectEvaluationCases(catalog, {
      ...selection,
      ids: ['c', 'a', 'c'],
    }),
  ).toEqual([catalog[0], catalog[2]]);
});

test('selection rejects all unknown IDs before applying suite inclusion', () => {
  for (const ids of [
    ['a', 'typo', 'missing', 'typo'],
    ['typo', 'missing'],
  ]) {
    let included = false;
    expect(() =>
      selectEvaluationCases(catalog, {
        ...selection,
        ids,
        include() {
          included = true;
          return false;
        },
      }),
    ).toThrow(
      'Unknown evaluation case IDs: typo, missing. Choose IDs from the evaluation catalog.',
    );
    expect(included).toBe(false);
  }
});

test('valid IDs outside the suite are excluded, not unknown', () => {
  const include = (x: (typeof catalog)[number]) => x.suite === 'dev';
  expect(
    selectEvaluationCases(catalog, {
      ...selection,
      ids: ['c', 'b', 'a'],
      include,
    }),
  ).toEqual([catalog[0], catalog[2]]);
  expect(
    selectEvaluationCases(catalog, {
      ...selection,
      ids: ['b'],
      include,
    }),
  ).toEqual([]);
});

test('empty and omitted IDs select the full catalog subject to inclusion', () => {
  for (const ids of [undefined, []]) {
    expect(selectEvaluationCases(catalog, { ...selection, ids })).toEqual(
      catalog,
    );
    expect(
      selectEvaluationCases(catalog, {
        ...selection,
        ids,
        include: (x) => x.suite === 'dev',
      }),
    ).toEqual([catalog[0], catalog[2]]);
    expect(selectEvaluationCases([], { ...selection, ids })).toEqual([]);
  }
});

test('shared expansion owns case/repeat/runtime ordering, prepare-once and complete reporting/accounting', async () => {
  const events: string[] = [];
  const run = await runEvaluationRun({
    ...basic,
    preflight() {
      events.push('preflight');
    },
    prepare(value) {
      events.push(`prepare:${value}`);
      return value;
    },
    sampleCount: (prepared, repeats) => (prepared === 'b' ? 1 : repeats),
    onEvaluation(result) {
      events.push(`sample:${result.identity.caseId}`);
      (result.identity as { sample: number }).sample = 99;
    },
    report(result) {
      events.push('report');
      expect(result.records).toEqual([
        'a/1/one',
        'a/1/two',
        'a/2/one',
        'a/2/two',
        'b/1/one',
        'b/1/two',
      ]);
      expect(result.accounting).toEqual({
        selectedCases: 2,
        plannedSamples: 6,
        completedSamples: 6,
        execution: { completed: 6, error: 0, invalid: 0 },
        evaluation: { pass: 6, fail: 0, unscored: 0, not_applicable: 0 },
        cleanupFailures: 0,
        judge: {
          scored: 0,
          failed: 0,
          notRun: 6,
          reasons: { disabled: 6 },
          means: [],
        },
      });
    },
  });
  expect(events.slice(0, 3)).toEqual(['preflight', 'prepare:a', 'prepare:b']);
  expect(events.at(-1)).toBe('report');
  expect(run.policy).toBe('synthetic:contract/v1');
  expect(run.samples.map((sample) => sample.identity.sample)).toEqual([
    1, 1, 2, 2, 1, 1,
  ]);
});

test('shared concurrency is bounded while report order stays deterministic', async () => {
  const first = latch();
  const laterCompleted = latch();
  let active = 0;
  let peak = 0;
  const progress: number[] = [];
  const pending = runEvaluationRun({
    ...basic,
    cases: ['a'],
    runtimes: ['one'],
    repeats: 3,
    concurrency: 2,
    invocation(_value, _prepared, _runtime, identity) {
      return {
        adapter: {
          ...adapter(String(identity.sample)),
          async execute() {
            active++;
            peak = Math.max(peak, active);
            if (identity.sample === 1) await first.promise;
            active--;
            return {
              completeness: 'complete',
              disposition: 'planned',
              value: String(identity.sample),
            };
          },
        },
        finish: (result) => Number(result.observation),
      };
    },
    onRecord(value) {
      progress.push(value);
      if (value === 3) laterCompleted.resolve();
    },
  });
  await laterCompleted.promise;
  expect(progress).toEqual([2, 3]);
  first.resolve();
  const run = await pending;
  expect(run.records).toEqual([1, 2, 3]);
  expect(peak).toBe(2);
});

test('native policy failure stops admission, drains in-flight samples and never reports a partial run as complete', async () => {
  const second = latch();
  const started = latch();
  const failure = new Error('native policy');
  const admitted: number[] = [];
  const disposed: number[] = [];
  let reported = false;
  let settled = false;
  const pending = runEvaluationRun({
    ...basic,
    cases: ['a'],
    runtimes: ['one'],
    repeats: 4,
    concurrency: 2,
    invocation(_value, _prepared, _runtime, identity) {
      admitted.push(identity.sample);
      return {
        adapter: {
          ...adapter(String(identity.sample)),
          async execute() {
            if (identity.sample === 2) {
              started.resolve();
              await second.promise;
            }
            return {
              completeness: 'complete',
              disposition: 'planned',
              value: String(identity.sample),
            };
          },
          dispose() {
            disposed.push(identity.sample);
          },
        },
        finish(result) {
          if (identity.sample === 1) throw failure;
          return result.observation;
        },
      };
    },
    report() {
      reported = true;
    },
  }).then(
    () => {
      throw new Error('Expected rejection');
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  await started.promise;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(settled).toBe(false);
  expect(admitted).toEqual([1, 2]);
  second.resolve();
  expect(await pending).toBe(failure);
  expect(disposed).toEqual([1, 2]);
  expect(reported).toBe(false);
});

test('accounting separates source score opt-out, invalid/runtime failures and cleanup failures', async () => {
  const run = await runEvaluationRun({
    ...basic,
    cases: ['unscored', 'invalid', 'error', 'cleanup'],
    runtimes: ['one'],
    repeats: 1,
    invocation(value) {
      return {
        adapter: {
          ...adapter(value),
          preflight() {
            if (value === 'invalid') throw new Error('invalid');
          },
          async execute() {
            if (value === 'error') throw new Error('runtime');
            return { completeness: 'complete', disposition: 'planned', value };
          },
          score() {
            return {
              outcome: value === 'unscored' ? 'unscored' : 'pass',
              failures: [],
            };
          },
          dispose() {
            if (value === 'cleanup') throw new Error('cleanup');
          },
        },
        finish: (result) => result.evaluation,
      };
    },
  });
  expect(run.accounting).toMatchObject({
    execution: { completed: 2, invalid: 1, error: 1 },
    evaluation: { pass: 1, fail: 0, unscored: 3, not_applicable: 0 },
    cleanupFailures: 1,
  });
});

test('duplicate sample identity and invalid expansion controls reject before executing', async () => {
  let invoked = 0;
  for (const override of [
    { repeats: 0 },
    { concurrency: 0 },
    { repeats: Infinity },
    { runtimes: ['same', 'same'] },
    { cases: ['same', 'same'] },
  ]) {
    await expect(
      runEvaluationRun({
        ...basic,
        ...override,
        invocation(...args) {
          invoked++;
          return basic.invocation(...args);
        },
      }),
    ).rejects.toThrow();
  }
  expect(invoked).toBe(0);
});

test('asynchronous report completion is part of the shared run promise and report failures propagate unchanged', async () => {
  const writing = latch();
  const finished = latch();
  let settled = false;
  const pending = runEvaluationRun({
    ...basic,
    async report() {
      writing.resolve();
      await finished.promise;
    },
  }).then((run) => {
    settled = true;
    return run;
  });
  await writing.promise;
  expect(settled).toBe(false);
  finished.resolve();
  expect((await pending).records).toHaveLength(8);
  const failure = new Error('report failure');
  await expect(
    runEvaluationRun({
      ...basic,
      report() {
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
});
