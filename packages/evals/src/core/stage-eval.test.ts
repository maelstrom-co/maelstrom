import { describe, expect, test } from 'bun:test';
import { deferred, type Stage } from '@maelstrom-co/engine';
import { err, ok } from '@maelstrom-co/protocol';
import { type EvaluationResult, evaluateSample } from './runtime/evaluate.js';
import { type Scenario, selectScenarios } from './scenarios.js';
import {
  registerStageEval,
  runStageEval,
  type StageEvalModule,
  type StageTurnRecord,
} from './stage-eval.js';

interface ShoutDeps {
  readonly transform: (text: string) => string;
}

/**
 * A stage that returns the scenario id transformed by its deps: `upper`
 * shouts it, `same` leaves it, `defer` defers, and `throw` throws. Every
 * variant reports one call through the deps. Only planned scenarios form
 * an input.
 */
function shoutModule(options: { readonly suffix?: string } = {}) {
  const suffix = options.suffix ?? '';
  const stage =
    (transform: (deps: ShoutDeps, text: string) => string) =>
    (deps: ShoutDeps): Stage<string, string> =>
    async (input) =>
      ok(transform(deps, input) + suffix);
  const module: StageEvalModule<string, string, { length: number }, ShoutDeps> =
    {
      name: 'shout',
      stage: 'shout',
      provider: 'Echo',
      requiredEnv: ['ECHO_KEY'],
      variants: {
        upper: stage((deps, text) => deps.transform(text)),
        same: stage((_deps, text) => text),
        defer: () => async () => err(deferred('shout/too_quiet')),
        throw: () => async () => {
          throw new Error('lost voice');
        },
      },
      makeDeps: (onCall) => ({
        transform: (text) => {
          onCall({ latencyMs: 2, usage: { inputTokens: 3, outputTokens: 1 } });
          return text.toUpperCase();
        },
      }),
      flags: { suffix: { type: 'string', default: '' } },
      configure: async (values, run) => ({
        module: shoutModule({ suffix: String(values.suffix ?? '') }),
        meta: { suffix: String(values.suffix ?? ''), turns: run.repeats },
      }),
      prepare: async (scenario: Scenario, ctx) =>
        scenario.expected.status === 'planned'
          ? { applicable: true, input: scenario.id, origin: ctx.origin }
          : { applicable: false, reason: 'expects a deferral' },
      expectedDeferral: (scenario) =>
        scenario.id === 'preserve' ? 'shout/too_quiet' : undefined,
      judge: (scenario, _input, output) => ({
        outcome: output === scenario.id.toUpperCase() ? 'pass' : 'fail',
        failures: output === scenario.id.toUpperCase() ? [] : [`got ${output}`],
        detail: { length: output.length },
      }),
      reportSections: (records) => [`## ${records.length} turns`],
    };
  return module;
}

describe('stage eval', () => {
  test('runs every variant on each applicable scenario with the module deps, recording calls and detail', async () => {
    const scenarios = selectScenarios('development', ['swap', 'ambiguous']);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'ambiguous',
      'swap',
    ]);
    const records = await runStageEval(shoutModule(), {
      scenarios,
      variants: ['upper', 'same'],
      repeats: 2,
    });
    expect(
      records.map((record) => [
        record.scenarioId,
        record.repeat,
        record.variant,
        record.outcome,
      ]),
    ).toEqual([
      ['ambiguous', 1, 'upper', 'not_applicable'],
      ['ambiguous', 1, 'same', 'not_applicable'],
      ['swap', 1, 'upper', 'pass'],
      ['swap', 1, 'same', 'fail'],
      ['swap', 2, 'upper', 'pass'],
      ['swap', 2, 'same', 'fail'],
    ]);
    const [notApplicable, , upper, same] = records;
    expect(upper?.stage).toBe('shout');
    expect(upper?.calls).toEqual([
      { latencyMs: 2, usage: { inputTokens: 3, outputTokens: 1 } },
    ]);
    expect(upper?.detail).toEqual({ length: 4 });
    expect(upper?.stageMs).toBeGreaterThanOrEqual(0);
    expect(same?.calls).toEqual([]);
    expect(same?.failures).toEqual(['got swap']);
    expect(notApplicable?.reason).toBe('expects a deferral');
    expect(notApplicable?.calls).toEqual([]);
    expect(notApplicable?.stageMs).toBe(undefined);
  });

  test('records a turn whose deps or stage cannot be built as an error and runs the rest', async () => {
    const shout = shoutModule();
    let built = 0;
    const module: typeof shout = {
      ...shout,
      variants: {
        ...shout.variants,
        broken: () => {
          throw new Error('no stage to build');
        },
      },
      makeDeps: (onCall) => {
        built += 1;
        if (built === 1) throw new Error('no deps on the first turn');
        return shout.makeDeps(onCall);
      },
    };
    const records = await runStageEval(module, {
      scenarios: selectScenarios('development', ['swap']),
      variants: ['upper', 'broken'],
      repeats: 2,
    });
    expect(
      records.map((record) => [
        record.repeat,
        record.variant,
        record.outcome,
        record.reason,
      ]),
    ).toEqual([
      [1, 'upper', 'error', 'no deps on the first turn'],
      [1, 'broken', 'error', 'no stage to build'],
      [2, 'upper', 'pass', undefined],
      [2, 'broken', 'error', 'no stage to build'],
    ]);
    expect(records[0]?.calls).toEqual([]);
  });

  test('records a deferral, an error and a missed expected deferral', async () => {
    const scenarios = selectScenarios('development', ['swap', 'preserve']);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'preserve',
      'swap',
    ]);
    const records = await runStageEval(shoutModule(), {
      scenarios,
      variants: ['defer', 'throw', 'upper'],
      repeats: 1,
    });
    expect(
      records.map((record) => [
        record.scenarioId,
        record.variant,
        record.outcome,
        record.reason,
      ]),
    ).toEqual([
      ['preserve', 'defer', 'pass', 'shout/too_quiet'],
      ['preserve', 'throw', 'error', 'lost voice'],
      ['preserve', 'upper', 'fail', undefined],
      ['swap', 'defer', 'deferred', 'shout/too_quiet'],
      ['swap', 'throw', 'error', 'lost voice'],
      ['swap', 'upper', 'pass', undefined],
    ]);
    expect(records[2]?.failures).toEqual([
      'expected a deferral: shout/too_quiet',
    ]);
    expect(records[0]?.expectedDeferral).toBe('shout/too_quiet');
  });

  test('rejects an unknown variant before running', async () => {
    await expect(
      runStageEval(shoutModule(), {
        scenarios: selectScenarios('development', ['swap']),
        variants: ['whisper'],
        repeats: 1,
      }),
    ).rejects.toThrow(
      'unknown shout variant whisper; known variants: upper, same, defer, throw',
    );
  });

  test('keeps the record order under concurrency', async () => {
    const scenarios = selectScenarios('development', [
      'swap',
      'quoted-location',
    ]);
    const records = await runStageEval(shoutModule(), {
      scenarios,
      variants: ['upper', 'same'],
      repeats: 2,
      concurrency: 3,
    });
    expect(
      records.map(
        (record) => `${record.scenarioId}/${record.repeat}/${record.variant}`,
      ),
    ).toEqual(
      scenarios.flatMap((scenario) =>
        [1, 2].flatMap((repeat) =>
          ['upper', 'same'].map(
            (variant) => `${scenario.id}/${repeat}/${variant}`,
          ),
        ),
      ),
    );
  });

  test('a registered module erases its types and configures itself from the CLI flags', async () => {
    const registered = registerStageEval(shoutModule());
    expect(registered).toMatchObject({
      name: 'shout',
      stage: 'shout',
      provider: 'Echo',
      requiredEnv: ['ECHO_KEY'],
      variants: ['upper', 'same', 'defer', 'throw'],
      flags: { suffix: { type: 'string', default: '' } },
    });
    const scenarios = selectScenarios('development', ['swap']);
    const configured = await registered.configure(
      { suffix: '!' },
      { scenarios, repeats: 2 },
    );
    expect(configured.meta).toEqual({ suffix: '!', turns: 2 });
    const records = await configured.module.run({
      scenarios,
      variants: ['upper'],
      repeats: 1,
    });
    expect(records[0]?.outcome).toBe('fail');
    expect(records[0]?.failures).toEqual(['got SWAP!']);
    expect(configured.module.reportSections(records, ['upper'])).toEqual([
      '## 1 turns',
    ]);
  });

  test('a module without configure runs as it is, with no meta', async () => {
    const { configure: _configure, ...bare } = shoutModule();
    const registered = registerStageEval(bare);
    const configured = await registered.configure(
      {},
      { scenarios: [], repeats: 1 },
    );
    expect(configured.meta).toEqual({});
    expect(configured.module.variants).toEqual(registered.variants);
  });
});

test('native stage lifecycle preserves prepare-once, concurrent repeats and separate operational evidence', async () => {
  const original = shoutModule();
  let prepares = 0;
  const inputs: number[] = [];
  const results: EvaluationResult<StageTurnRecord>[] = [];
  const module = {
    ...original,
    async prepare(...args: Parameters<typeof original.prepare>) {
      prepares++;
      return original.prepare(...args);
    },
    turnInput(_scenario: Scenario, repeat: number, input: string) {
      inputs.push(repeat);
      return input;
    },
  };
  const scenarios = selectScenarios('development', ['swap']);
  const records = await runStageEval(module, {
    scenarios,
    variants: ['upper', 'same'],
    repeats: 3,
    concurrency: 3,
    runId: 'stages-test',
    onEvaluation(result) {
      results.push(result);
    },
  });
  expect(prepares).toBe(1);
  expect(inputs).toEqual([1, 1, 2, 2, 3, 3]);
  expect(results).toHaveLength(6);
  for (const record of records) {
    expect(record.operational?.completeness).toBe('complete');
    expect(
      record.operational?.groups.map((g) => [g.operation, g.outcome, g.count]),
    ).toEqual([
      ['engine.stage', 'started', 1],
      ['engine.stage', 'succeeded', 1],
    ]);
  }
  const registered = registerStageEval(module);
  const single = await evaluateSample(
    { runId: 'one', caseId: 'swap', runtimeId: 'upper', sample: 7 },
    registered.adapter({
      scenario: scenarios[0],
      variant: 'upper',
      provenance: 'test',
    }),
  );
  expect(single.observation?.repeat).toBe(7);
  expect(inputs.at(-1)).toBe(7);
});

test('judge failures retain completed operational observations and native exception semantics', async () => {
  const original = shoutModule();
  const failure = new Error('judge failed');
  const module = {
    ...original,
    judge() {
      throw failure;
    },
  };
  const scenarios = selectScenarios('development', ['swap']);
  await expect(
    runStageEval(module, { scenarios, variants: ['upper'], repeats: 1 }),
  ).rejects.toBe(failure);
  const samples: EvaluationResult<StageTurnRecord>[] = [];
  const [record] = await runStageEval(module, {
    scenarios,
    variants: ['upper'],
    repeats: 1,
    captureJudgeFailure: true,
    onEvaluation(result) {
      samples.push(result);
    },
  });
  expect(record.judgeFailure?.message).toBe('judge failed');
  expect(samples[0].error?.phase).toBe('scoring');
  expect(samples[0].evaluation).toBe('unscored');
  expect(
    record.operational?.groups.some((g) => g.outcome === 'succeeded'),
  ).toBe(true);
});

test('a reused isolated-stage adapter prepares and collects independently for concurrent samples', async () => {
  const original = shoutModule();
  let prepares = 0;
  const module = registerStageEval({
    ...original,
    async prepare(...args: Parameters<typeof original.prepare>) {
      prepares++;
      return original.prepare(...args);
    },
  });
  const scenario = selectScenarios('development', ['swap'])[0];
  const adapter = module.adapter({
    scenario,
    variant: 'upper',
    provenance: 'synthetic',
  });
  const results = await Promise.all(
    [1, 2, 3].map((sample) =>
      evaluateSample(
        {
          runId: 'stage-concurrent',
          caseId: scenario.id,
          runtimeId: 'upper',
          sample,
        },
        adapter,
      ),
    ),
  );
  expect(prepares).toBe(3);
  for (const result of results) {
    expect(result.evaluation).toBe('pass');
    expect(result.operational?.groups.map((group) => group.count)).toEqual([
      1, 1,
    ]);
  }
});

test('reused stage adapters isolate out-of-order judge errors and subsequent successful invocations', async () => {
  let release!: () => void;
  const slow = new Promise<void>((done) => {
    release = done;
  });
  const module: StageEvalModule<string, string, string, undefined> = {
    name: 'mixed-judge',
    stage: 'mixed-judge',
    makeDeps: () => undefined,
    variants: {
      echo: () => async (input) => {
        if (input === 'sample-1') await slow;
        return ok(input);
      },
    },
    prepare: async (_scenario, ctx) => ({
      applicable: true,
      input: 'prepared',
      origin: ctx.origin,
    }),
    turnInput: (_scenario, repeat) => `sample-${repeat}`,
    judge: (_scenario, _input, output) => {
      if (output === 'sample-1') throw new Error('only-first-judge');
      return { outcome: 'pass', failures: [], detail: output };
    },
  };
  const scenario = selectScenarios('development', ['swap'])[0];
  const adapter = registerStageEval(module).adapter({
    scenario,
    variant: 'echo',
    provenance: 'synthetic',
  });
  expect('rethrowJudge' in adapter).toBe(false);
  const invoke = (sample: number) =>
    evaluateSample(
      { runId: 'mixed', caseId: scenario.id, runtimeId: 'echo', sample },
      adapter,
    );
  const first = invoke(1);
  const second = await invoke(2);
  expect(second.evaluation).toBe('pass');
  expect(second.observation?.detail).toBe('sample-2');
  release();
  const failed = await first;
  expect(failed.error?.phase).toBe('scoring');
  expect(failed.error?.message).toBe('only-first-judge');
  const third = await invoke(3);
  expect(third.evaluation).toBe('pass');
  expect(third.error).toBeUndefined();
  expect(third.observation?.detail).toBe('sample-3');
  expect(second.error).toBeUndefined();
});
