import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOk, type MaelstromResponse, ok } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import {
  type FakeCall,
  type FakeScript,
  fakePluginWith,
  scriptedJudge,
  TOKYO_CANDIDATE,
} from './__test-helpers__/fake-planner.js';
import { silentLogger } from './__test-helpers__/fixtures.js';
import { resolveArms } from './arms.js';
import { GRADER_VERSION } from './grader.js';
import type { JudgeVerdict } from './plugin.js';
import { loadReplay, writeStageFile } from './replay.js';
import { writeReport } from './report.js';
import {
  grade,
  plannerTurnAdapter,
  type RunRecord,
  runEval,
  unmappedPhases,
} from './run.js';
import { type EvaluationResult, evaluateSample } from './runtime/evaluate.js';
import { selectScenarios } from './scenarios.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

// No arm of the fake family touches the adapter.
const unusedAdapter = {
  kind: 'text',
  name: 'unused',
  model: 'unused-model',
} as unknown as AnyTextAdapter;

async function outDir() {
  const out = await mkdtemp(join(tmpdir(), 'evals-core-'));
  dirs.push(out);
  return out;
}

const tokyo: FakeScript = { candidate: () => TOKYO_CANDIDATE };

function run(
  script: FakeScript,
  ids: readonly string[],
  extra: Omit<Partial<Parameters<typeof runEval>[0]>, 'arms'> & {
    readonly arms?: readonly string[];
  } = {},
) {
  const plugin = fakePluginWith(script);
  const { arms, ...options } = extra;
  return runEval({
    scenarios: selectScenarios('all', ids),
    arms: resolveArms([plugin], arms ?? ['fake-baseline', 'fake']),
    repeats: 1,
    adapter: unusedAdapter,
    fallback: () => async () => ok(TOKYO_CANDIDATE),
    ...options,
  });
}

const fullMarks: JudgeVerdict = {
  answers: {
    request_satisfied: { score: 4, probabilities: { '4': 1 } },
    arrangement_match: { score: 3, probabilities: { '3': 1 } },
  },
  calls: [{ latencyMs: 9, usage: { inputTokens: 11, outputTokens: 2 } }],
};

test('runs a baseline and a staged arm and keeps the runner and plugin fields apart', async () => {
  const out = await outDir();
  const records = await run(tokyo, ['quoted-location', 'ambiguous'], { out });

  expect(records.map((r) => `${r.scenarioId}/${r.arm}/${r.kind}`)).toEqual([
    'quoted-location/fake-baseline/baseline',
    'quoted-location/fake/fake',
    'ambiguous/fake-baseline/baseline',
    'ambiguous/fake/fake',
  ]);
  const [baseline, staged] = records;
  expect(baseline?.score?.pass).toBe(true);
  expect(baseline?.stages).toBe(undefined);
  expect(baseline?.picked).toBe(undefined);
  expect(baseline?.fallbackCalls).toBe(undefined);
  expect(staged?.score?.pass).toBe(true);
  expect(staged?.fallbackCalls).toBe(0);
  expect(staged?.stages?.map((stage) => [stage.stage, stage.outcome])).toEqual([
    ['pick', 'ok'],
    ['write', 'ok'],
  ]);
  expect(staged?.picked).toEqual([
    'calendar-main',
    'weather-main',
    'tasks-main',
    'map-main',
    'journal-main',
  ]);
  expect(
    (staged?.fakeCalls as readonly FakeCall[]).map((call) => call.stage),
  ).toEqual(['pick', 'write']);
  // The scripted planner answers, so the expected deferral does not happen.
  expect(records[3]?.deferredAsExpected).toBe(false);

  const stageFile = JSON.parse(
    await readFile(
      join(out, 'stages', 'fake', 'quoted-location-1.json'),
      'utf8',
    ),
  );
  expect(
    stageFile.stages.map((stage: { stage: string }) => stage.stage),
  ).toEqual(['pick', 'write']);
  expect(stageFile.stages[0].input.request.type).toBe('chart_request');
  expect(stageFile.stages[0].output.picked).toHaveLength(5);

  await writeReport(
    out,
    records,
    { repeats: 1 },
    { plugins: [fakePluginWith(tokyo)] },
  );
  const report = await readFile(join(out, 'report.md'), 'utf8');
  expect(report).toContain('| Metric | fake-baseline | fake |');
  expect(report).toContain('| Fake picks | n/a | 10 |');
  expect(report).toContain('| pick latency p50 / p95 (ms) | n/a | ');
  const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
  expect(summary.summaries.map((s: { arm: string }) => s.arm)).toEqual([
    'fake-baseline',
    'fake-baseline',
    'fake',
    'fake',
  ]);
  const saved = JSON.parse(await readFile(join(out, 'records.json'), 'utf8'));
  expect(saved[1].stages[0].input).toBe(undefined);
});

test('the run record keeps the same keys for a baseline and a staged turn', async () => {
  const [baseline, staged] = await run(tokyo, ['quoted-location']);
  expect(Object.keys(baseline ?? {}).sort()).toEqual([
    'arm',
    'arrangementRules',
    'executionPlan',
    'expectedDeferral',
    'expectsActions',
    'instances',
    'kind',
    'llmCalls',
    'operational',
    'repeat',
    'scenarioId',
    'score',
    'suite',
    'tree',
    'turnMs',
    'userMessage',
  ]);
  expect(Object.keys(staged ?? {}).sort()).toEqual([
    'arm',
    'arrangementRules',
    'executionPlan',
    'expectedDeferral',
    'expectsActions',
    'fakeCalls',
    'fallbackCalls',
    'instances',
    'kind',
    'llmCalls',
    'operational',
    'picked',
    'repeat',
    'scenarioId',
    'score',
    'stages',
    'suite',
    'tree',
    'turnMs',
    'userMessage',
  ]);
});

test('a deferral runs the counted fallback and is recorded with its stage and reason', async () => {
  const [record] = await run(
    { ...tokyo, deferAt: 'write', code: 'no_layout' },
    ['quoted-location'],
    { arms: ['fake'] },
  );
  expect(record?.deferral).toEqual({
    stage: 'write',
    reason: 'write/no_layout',
    provider: false,
  });
  expect(record?.fallbackCalls).toBe(1);
  expect(record?.score?.pass).toBe(true);
  expect(record?.stages?.map((stage) => stage.outcome)).toEqual([
    'ok',
    'deferred',
  ]);
  const [provider] = await run(
    { ...tokyo, deferAt: 'pick', code: 'provider_http' },
    ['quoted-location'],
    { arms: ['fake'] },
  );
  expect(provider?.deferral?.provider).toBe(true);
  expect(provider?.stages).toHaveLength(1);
});

test('an expected deferral is judged at the phase the plugin maps the scenario to', async () => {
  // generate-content expects a deferral at the select phase; the fake maps it to pick.
  const [atPick] = await run(
    { ...tokyo, deferAt: 'pick' },
    ['generate-content'],
    {
      arms: ['fake'],
    },
  );
  expect(atPick?.expectedDeferral).toBe(true);
  expect(atPick?.deferredAsExpected).toBe(true);
  const [atWrite] = await run(
    { ...tokyo, deferAt: 'write' },
    ['generate-content'],
    {
      arms: ['fake'],
    },
  );
  expect(atWrite?.deferredAsExpected).toBe(false);
  // missing-enum names no phase, so any deferral counts.
  const [missingEnum] = selectScenarios('all', ['missing-enum']);
  expect(missingEnum?.expected).toEqual({ status: 'deferred' });
  const [any] = await run({ ...tokyo, deferAt: 'write' }, ['missing-enum'], {
    arms: ['fake'],
  });
  expect(any?.deferredAsExpected).toBe(true);
  const [none] = await run(tokyo, ['missing-enum'], { arms: ['fake'] });
  expect(none?.deferredAsExpected).toBe(false);
});

test('refuses, before any turn, a scenario whose deferral phase a staged arm cannot map', async () => {
  // tiny-resize expects a deferral at the layout phase.
  const plugin = fakePluginWith(tokyo);
  const selectOnly = { ...plugin, phases: { select: 'pick' as const } };
  const scenarios = selectScenarios('all', ['tiny-resize']);
  let turns = 0;
  const options = {
    scenarios,
    repeats: 1,
    adapter: unusedAdapter,
    fallback: () => async () => ok(TOKYO_CANDIDATE),
    onRecord: () => {
      turns += 1;
    },
  };
  await expect(
    runEval({ ...options, arms: resolveArms([selectOnly], ['fake']) }),
  ).rejects.toThrow(
    'plugin fake maps no stage to phase layout, which scenario tiny-resize expects to defer at',
  );
  expect(turns).toBe(0);
  expect(
    unmappedPhases(resolveArms([selectOnly], ['fake-baseline']), scenarios),
  ).toEqual([]);
});

test('refuses a recordTurn field the runner owns', async () => {
  const plugin = fakePluginWith(tokyo);
  const clobbering = {
    ...plugin,
    recordTurn: () => ({ fallbackCalls: 0, picked: [] }),
  };
  await expect(
    runEval({
      scenarios: selectScenarios('all', ['quoted-location']),
      arms: resolveArms([clobbering], ['fake']),
      repeats: 1,
      adapter: unusedAdapter,
      fallback: () => async () => ok(TOKYO_CANDIDATE),
    }),
  ).rejects.toThrow(
    'plugin fake sets fallbackCalls in a run record, which the runner owns',
  );
  // Reserved even when the runner leaves it out of this turn's record.
  const scoring = { ...plugin, recordTurn: () => ({ grader: {} }) };
  await expect(
    runEval({
      scenarios: selectScenarios('all', ['quoted-location']),
      arms: resolveArms([scoring], ['fake']),
      repeats: 1,
      adapter: unusedAdapter,
      fallback: () => async () => ok(TOKYO_CANDIDATE),
    }),
  ).rejects.toThrow('plugin fake sets grader in a run record');
});

test('replays recorded upstream stages and runs the rest live', async () => {
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out });

  const [record] = await run(
    { ...tokyo, deferAt: 'pick' },
    ['quoted-location'],
    {
      arms: ['fake'],
      replay: { source: await loadReplay(out, 'fake'), through: 'select' },
    },
  );
  expect(record?.deferral).toBe(undefined);
  expect(record?.score?.pass).toBe(true);
  expect(
    record?.stages?.map((stage) => [stage.stage, stage.replayed ?? false]),
  ).toEqual([
    ['pick', true],
    ['write', false],
  ]);
  expect(
    (record?.fakeCalls as readonly FakeCall[]).map((call) => call.stage),
  ).toEqual(['write']);
});

test('refuses a replay the plugin says the arm cannot read, before any turn', async () => {
  const out = await outDir();
  const [scenario] = selectScenarios('development', ['quoted-location']);
  if (!scenario) throw new Error('fixture scenario is missing');
  await writeStageFile(out, {
    arm: 'fake',
    scenarioId: scenario.id,
    repeat: 1,
    stages: [
      {
        stage: 'pick',
        ms: 1,
        outcome: 'ok',
        input: { request: scenario.request, history: [] },
        output: { input: {} },
      },
    ],
  });
  const source = await loadReplay(out, 'fake');
  await expect(
    run(tokyo, ['quoted-location'], {
      arms: ['fake'],
      replay: { source, through: 'select' },
    }),
  ).rejects.toThrow('- fake: pick has no picked (1 turns: quoted-location #1)');
  await expect(
    run(tokyo, ['quoted-location', 'ambiguous'], {
      arms: ['fake'],
      replay: { source, through: 'select' },
    }),
  ).rejects.toThrow('ambiguous #1: no recorded turn');
});

test('grades every planned shipped response with the judge, its calls kept on the record', async () => {
  const judge = scriptedJudge(() => fullMarks);
  const records = await run(tokyo, ['quoted-location', 'ambiguous'], { judge });
  const [baseline, staged, baselineDeferral, stagedDeferral] = records;
  for (const record of [baseline, staged]) {
    expect(record?.grader?.dimensions).toEqual({
      request_satisfied: { score: 1, samples: [4] },
      arrangement_match: { score: 0.75, samples: [3] },
    });
    expect(record?.grader?.calls).toEqual([
      { latencyMs: 9, usage: { inputTokens: 11, outputTokens: 2 } },
    ]);
  }
  expect(judge.inputs).toHaveLength(2);
  expect(judge.inputs[0]?.state.userMessage).toBe('Tokyo it is.');
  expect(baselineDeferral?.grader).toBe(undefined);
  expect(stagedDeferral?.grader).toBe(undefined);
});

test('a judge failure is recorded without touching the turn', async () => {
  const judge = scriptedJudge(() => ({
    failure: 'grader/provider_http',
    calls: [{ latencyMs: 5, outcome: 'provider_http' }],
  }));
  const [record] = await run(tokyo, ['quoted-location'], {
    arms: ['fake'],
    judge,
  });
  expect(record?.error).toBe(undefined);
  expect(record?.score?.pass).toBe(true);
  expect(record?.grader?.failure).toBe('grader/provider_http');
  expect(record?.grader?.calls).toEqual([
    { latencyMs: 5, outcome: 'provider_http' },
  ]);
});

test('grade catches an exception the judge raises and records grader/exception with its cause and the calls before it, never throwing', async () => {
  const [scenario] = selectScenarios('development', ['quoted-location']);
  if (!scenario) throw new Error('fixture scenario is missing');
  const nearBoundary = { score: 3, probabilities: { '3': 0.5, '4': 0.45 } };
  const throwingJudge = scriptedJudge((_input, call) => {
    if (call === 0)
      return {
        answers: {
          request_satisfied: nearBoundary,
          arrangement_match: nearBoundary,
        },
        calls: [{ latencyMs: 4 }],
      };
    throw new Error('boom', { cause: new TypeError('bad shape') });
  });
  const logged: unknown[] = [];
  const response = {
    type: 'maelstrom_response',
    requestId: 'r',
    userMessage: 'Done.',
    rationale: '',
    executionPlan: [],
    layout: {
      type: 'tiling',
      tree: [],
      instances: scenario.request.instances,
    },
  } as unknown as MaelstromResponse;
  await expect(
    grade(throwingJudge, scenario, response, {
      ...silentLogger,
      error: (message, context) => logged.push({ message, context }),
    }),
  ).resolves.toEqual({
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    failure: 'grader/exception: boom (cause: bad shape)',
    calls: [{ latencyMs: 4 }],
  });
  expect(logged).toEqual([
    {
      message: 'grader threw',
      context: { scenario: 'quoted-location', error: expect.any(Error) },
    },
  ]);
  await expect(
    grade(
      throwingJudge,
      scenario,
      { ...response, layout: { type: 'grid', positions: [] } } as never,
      silentLogger,
    ),
  ).resolves.toMatchObject({ failure: 'grader/not_tiling' });
});

test('does not grade without a judge', async () => {
  const records = await run(tokyo, ['quoted-location']);
  expect(
    records.every((record: RunRecord) => record.grader === undefined),
  ).toBe(true);
  expect(isOk(ok(1))).toBe(true);
});

test('native planner lifecycle preserves repeat identity and deferral policy with isolated telemetry', async () => {
  const samples: EvaluationResult<RunRecord>[] = [];
  const records = await run(tokyo, ['quoted-location', 'ambiguous'], {
    repeats: 2,
    runId: 'native-test',
    onEvaluation(result) {
      samples.push(result);
    },
  });
  expect(samples.map((sample) => sample.identity.sample)).toEqual([
    1, 1, 2, 2, 1, 1, 2, 2,
  ]);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const record = records[index];
    expect(sample.identity.runId).toBe('native-test');
    expect(sample.evaluation).toBe(
      record.expectedDeferral
        ? 'unscored'
        : record.score?.pass
          ? 'pass'
          : 'fail',
    );
    expect(record.operational).toEqual(sample.operational);
    expect(
      record.operational?.groups.find(
        (g) => g.operation === 'engine.request' && g.outcome === 'started',
      )?.count,
    ).toBe(1);
  }
  const plugin = fakePluginWith(tokyo);
  const scenario = selectScenarios('all', ['ambiguous'])[0];
  const adapter = plannerTurnAdapter({
    scenario,
    arm: resolveArms([plugin], ['fake'])[0],
    runtime: {
      adapter: unusedAdapter,
      fallback: () => async () => ok(TOKYO_CANDIDATE),
    },
    provenance: 'synthetic',
    policy: 'adapter',
  });
  const result = await evaluateSample(
    {
      runId: 'adapter-test',
      caseId: scenario.id,
      runtimeId: 'fake',
      sample: 3,
    },
    adapter,
  );
  expect(result.observation?.repeat).toBe(3);
  expect(result.evaluation).toBe('fail');
  expect(result.surface).toBe('planner-response');
});

test('a reused planner adapter isolates concurrent sample collectors', async () => {
  const plugin = fakePluginWith(tokyo);
  const scenario = selectScenarios('all', ['quoted-location'])[0];
  const adapter = plannerTurnAdapter({
    scenario,
    arm: resolveArms([plugin], ['fake'])[0],
    runtime: {
      adapter: unusedAdapter,
      fallback: () => async () => ok(TOKYO_CANDIDATE),
    },
    provenance: 'synthetic',
    policy: 'adapter',
  });
  const results = await Promise.all(
    [1, 2, 3].map((sample) =>
      evaluateSample(
        { runId: 'concurrent', caseId: scenario.id, runtimeId: 'fake', sample },
        adapter,
      ),
    ),
  );
  expect(results.map((result) => result.observation?.repeat)).toEqual([
    1, 2, 3,
  ]);
  for (const result of results) {
    expect(result.evaluation).toBe('pass');
    expect(result.operational?.completeness).toBe('complete');
    expect(
      result.operational?.groups.find(
        (group) =>
          group.operation === 'engine.request' && group.outcome === 'started',
      )?.count,
    ).toBe(1);
  }
});

test('shared native lifecycle replays the real repeat and labels replay provenance', async () => {
  const sourceDir = await outDir();
  const outputDir = await outDir();
  await run(tokyo, ['quoted-location'], {
    out: sourceDir,
    repeats: 2,
    arms: ['fake'],
  });
  const source = await loadReplay(sourceDir, 'fake');
  const samples: EvaluationResult<RunRecord>[] = [];
  await run({ ...tokyo, deferAt: 'pick' }, ['quoted-location'], {
    out: outputDir,
    repeats: 2,
    arms: ['fake'],
    onEvaluation(result) {
      samples.push(result);
    },
    replay: {
      through: 'select',
      source: {
        ...source,
        turn(id, repeat) {
          const turn = source.turn(id, repeat);
          if (!turn.stages) throw new Error('Missing synthetic replay stages');
          return {
            ...turn,
            stages: turn.stages.map((stage) => ({
              ...stage,
              output: { ...(stage.output as object), sourceRepeat: repeat },
            })),
          };
        },
      },
    },
  });
  for (const repeat of [1, 2]) {
    const saved = JSON.parse(
      await readFile(
        join(outputDir, 'stages/fake', `quoted-location-${repeat}.json`),
        'utf8',
      ),
    );
    expect(saved.stages[0].output.sourceRepeat).toBe(repeat);
    expect(samples[repeat - 1].provenance).toContain(
      'native:planner-replay/v1',
    );
    expect(samples[repeat - 1].evaluation).toBe('pass');
  }
});

test('reusable planner adapters expose no auxiliary getters and isolate late failure from successful responses', async () => {
  let release!: () => void;
  const slow = new Promise<void>((done) => {
    release = done;
  });
  const failure = new Error('first invocation postprocessing failed');
  const basePlugin = fakePluginWith(tokyo);
  const plugin: typeof basePlugin = {
    ...basePlugin,
    recordTurn(_scenario, _stages, calls) {
      if (calls.some((call) => call.stage === 'repeat-1')) throw failure;
      return {};
    },
  };
  const registered = {
    plugin,
    arm: {
      ...plugin.arms[1],
      name: 'mixed',
      build:
        (deps: Parameters<(typeof plugin.arms)[number]['build']>[0]) =>
        async (
          input: Parameters<
            ReturnType<(typeof plugin.arms)[number]['build']>
          >[0],
        ) => {
          const repeat = Number(String(input.messageId).split('-').at(-1));
          if (repeat === 1) await slow;
          deps.onCall({ stage: `repeat-${repeat}`, latencyMs: 0 });
          return ok({ ...TOKYO_CANDIDATE, userMessage: `response-${repeat}` });
        },
    },
  };
  const scenario = selectScenarios('all', ['quoted-location'])[0];
  const adapter = plannerTurnAdapter({
    scenario,
    arm: registered,
    provenance: 'synthetic',
    policy: 'adapter',
    runtime: {
      adapter: unusedAdapter,
      fallback: () => async () => ok(TOKYO_CANDIDATE),
    },
  });
  expect('rethrow' in adapter).toBe(false);
  expect('response' in adapter).toBe(false);
  const invoke = (sample: number) =>
    evaluateSample(
      { runId: 'mixed', caseId: scenario.id, runtimeId: 'mixed', sample },
      adapter,
    );
  const first = invoke(1);
  const second = await invoke(2);
  expect(second.evaluation).toBe('pass');
  expect(second.observation?.userMessage).toBe('response-2');
  release();
  expect((await first).error?.message).toBe(failure.message);
  const third = await invoke(3);
  expect(third.error).toBeUndefined();
  expect(third.evaluation).toBe('pass');
  expect(third.observation?.userMessage).toBe('response-3');
  expect(second.observation?.userMessage).toBe('response-2');
});

test('replay validator work grows linearly with the selected repeats', async () => {
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out, repeats: 6, arms: ['fake'] });
  const source = await loadReplay(out, 'fake');
  for (const repeats of [3, 6]) {
    let checks = 0;
    const fake = fakePluginWith(tokyo);
    const plugin: typeof fake = {
      ...fake,
      verifyReplay(record, arm) {
        checks++;
        return fake.verifyReplay?.(record, arm) ?? [];
      },
    };
    await runEval({
      scenarios: selectScenarios('all', ['quoted-location']),
      arms: resolveArms([plugin], ['fake']),
      repeats,
      adapter: unusedAdapter,
      fallback: () => async () => ok(TOKYO_CANDIDATE),
      replay: { source, through: 'select' },
    });
    // Whole-run validation and one exact-repeat check per standalone adapter.
    expect(checks).toBe(2 * repeats);
  }
});

test('standalone replay sample 3 validates only repeat 3', async () => {
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out, repeats: 3, arms: ['fake'] });
  const recorded = await loadReplay(out, 'fake');
  const seen: number[] = [];
  const scenario = selectScenarios('all', ['quoted-location'])[0];
  const plugin = fakePluginWith(tokyo);
  let checks = 0;
  const result = await evaluateSample(
    { runId: 'standalone', caseId: scenario.id, runtimeId: 'fake', sample: 3 },
    plannerTurnAdapter({
      scenario,
      arm: resolveArms(
        [
          {
            ...plugin,
            verifyReplay(record, arm) {
              checks++;
              return plugin.verifyReplay?.(record, arm) ?? [];
            },
          },
        ],
        ['fake'],
      )[0],
      runtime: {
        adapter: unusedAdapter,
        fallback: () => async () => ok(TOKYO_CANDIDATE),
        replay: {
          through: 'select',
          source: {
            ...recorded,
            turn(id, repeat) {
              seen.push(repeat);
              return repeat === 3
                ? recorded.turn(id, repeat)
                : { key: `${id} #${repeat}` };
            },
          },
        },
      },
      policy: 'adapter',
      provenance: 'synthetic',
    }),
  );
  expect(result.evaluation).toBe('pass');
  expect(checks).toBe(1);
  expect(seen).toEqual([3, 3, 3]);
});

test('invalid later replay repeat rejects the entire run before any turn executes', async () => {
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out, repeats: 3, arms: ['fake'] });
  const recorded = await loadReplay(out, 'fake');
  for (const failure of ['request', 'shape']) {
    let executed = 0;
    await expect(
      run(
        {
          candidate() {
            executed++;
            return TOKYO_CANDIDATE;
          },
        },
        ['quoted-location'],
        {
          arms: ['fake'],
          repeats: 3,
          replay: {
            through: 'select',
            source: {
              ...recorded,
              turn(id, repeat) {
                const turn = recorded.turn(id, repeat);
                return repeat !== 3
                  ? turn
                  : {
                      ...turn,
                      stages: turn.stages?.map((stage) => ({
                        ...stage,
                        ...(failure === 'request'
                          ? { input: {} }
                          : { output: {} }),
                      })),
                    };
              },
            },
          },
        },
      ),
    ).rejects.toThrow('quoted-location #3');
    expect(executed).toBe(0);
  }
});
