import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@maelstrom-co/engine';
import { pipeline, withFallback, withRetry } from '@maelstrom-co/engine';
import type { MaelstromResponse } from '@maelstrom-co/protocol';
import { isErr, ok } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import { conversation } from '../src/lib/__test-helpers__/actions-fixtures.js';
import {
  type ChatCall,
  dummyAdapter,
  mockChat,
} from '../src/lib/__test-helpers__/mock-chat.js';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '../src/lib/__test-helpers__/scripted-fetch.js';
import { FALLBACK_RETRIES } from '../src/lib/jev-planner.js';
import { stepwiseActions } from '../src/lib/stages-experimental/actions-stepwise.js';
import { completeWithLayout } from '../src/lib/stages-experimental/complete.js';
import { menuLayout } from '../src/lib/stages-experimental/layout-menu.js';
import { selectUngated } from '../src/lib/stages-experimental/select-ungated.js';
import type { LayoutStage } from '../src/lib/stages-experimental/types.js';
import type { Ask } from '../src/lib/typesafe-client.js';
import { type Arm, jevDeps, resolveArms } from './arms.js';
import { GRADER_VERSION } from './grader.js';
import { loadReplay, replayedStages } from './replay.js';
import { writeReport } from './report.js';
import { grade, runEval } from './run.js';
import { selectScenarios } from './scenarios.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const realFetch = globalThis.fetch;
const dirs: string[] = [];
afterEach(async () => {
  globalThis.fetch = realFetch;
  mockChat.mockReset();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

// Stands in for the provider behind chat(): every call reports usage.
const usageAdapter = {
  ...dummyAdapter,
  structuredOutput: async () => ({
    data: {},
    rawText: '{}',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  }),
} as unknown as AnyTextAdapter;

const BASELINE_RESPONSE = {
  userMessage: 'Baseline done.',
  rationale: 'r',
  executionPlan: [
    {
      instanceId: 'weather-main',
      action: 'setLocation',
      paramsJson: '{"location":"Tokyo"}',
    },
  ],
  layout: {
    tree: ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
      { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
      { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
      { instanceId: 'journal-main', vesselId: 'journal', variant: 'list' },
    ],
  },
};

function mockProvider() {
  globalThis.fetch = (() => {
    throw new Error('unexpected network call');
  }) as unknown as typeof fetch;
  mockChat.mockImplementation(async (options) => {
    const { adapter } = options as ChatCall & { adapter: AnyTextAdapter };
    await adapter.structuredOutput({} as never);
    if (!('layout' in options.outputSchema.shape))
      return { userMessage: 'Done.' };
    return BASELINE_RESPONSE;
  });
}

async function outDir() {
  const out = await mkdtemp(join(tmpdir(), 'planner-jev-eval-'));
  dirs.push(out);
  return out;
}

function run(
  script: Script,
  ids: readonly string[],
  extra: Partial<Parameters<typeof runEval>[0]> = {},
) {
  const { fetch } = scriptedFetch(script);
  return runEval({
    scenarios: selectScenarios('development', ids),
    arms: resolveArms(['baseline', 'jev-poc']),
    repeats: 1,
    adapter: usageAdapter,
    typesafe: { apiKey: 'typesafe-test-key', model: TEST_MODEL, fetch },
    ...extra,
  });
}

const tokyo = conversation({
  actions: [
    {
      pick: 'weather-main/setLocation',
      params: { location: { value: 'Tokyo' } },
    },
  ],
  layout: 'preserve',
});

test('runs two named arms offline and writes a complete report', async () => {
  mockProvider();
  const out = await outDir();
  const records = await run(tokyo, ['quoted-location', 'ambiguous'], { out });

  expect(records.map((r) => `${r.scenarioId}/${r.arm}`)).toEqual([
    'quoted-location/baseline',
    'quoted-location/jev-poc',
    'ambiguous/baseline',
    'ambiguous/jev-poc',
  ]);
  const [baseline, jevQuoted] = records;
  expect(baseline?.kind).toBe('baseline');
  expect(baseline?.score?.pass).toBe(true);
  expect(baseline?.llmCalls).toMatchObject([
    {
      role: 'planner',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    },
  ]);
  expect(jevQuoted?.kind).toBe('jev-poc');
  expect(jevQuoted?.score?.pass).toBe(true);
  expect(jevQuoted?.fallbackCalls).toBe(0);
  expect(jevQuoted?.stageScores?.actions?.pass).toBe(true);
  expect(jevQuoted?.jevCalls?.length).toBeGreaterThan(0);
  expect(jevQuoted?.llmCalls?.map((call) => call.role)).toEqual(['complete']);
  expect(jevQuoted?.minConfidence).toBe(1);
  // The script answers "supported", so the expected jevSelect deferral does not happen.
  expect(records[3]?.deferredAsExpected).toBe(false);

  const stageFile = JSON.parse(
    await readFile(
      join(out, 'stages', 'jev-poc', 'quoted-location-1.json'),
      'utf8',
    ),
  );
  expect(
    stageFile.stages.map((stage: { stage: string }) => stage.stage),
  ).toEqual(['jevSelect', 'jevActions', 'jevLayout', 'llmComplete']);
  expect(stageFile.stages[0].input.request.type).toBe('chart_request');

  await writeReport(out, records, { repeats: 1 });
  const report = await readFile(join(out, 'report.md'), 'utf8');
  expect(report).toContain('## development');
  expect(report).toContain('| Metric | baseline | jev-poc |');
  const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
  expect(summary.summaries.length).toBeGreaterThan(0);
  const saved = JSON.parse(await readFile(join(out, 'records.json'), 'utf8'));
  expect(saved).toHaveLength(4);
  expect(saved[1].stages[0].input).toBe(undefined);
});

test('records the gate answers of a gated arm and whether the scenario expects actions', async () => {
  mockProvider();
  const [gated] = await run(
    conversation({
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: { value: 'Tokyo' } },
        },
      ],
      layout: 'preserve',
      gates: {
        'gate/needsActions': 0.8,
        'gate/generatedContent': 0.05,
        'gate/spatial': 0.3,
      },
    }),
    ['quoted-location'],
    { arms: resolveArms(['jev-gated-batched']) },
  );
  expect(gated?.score?.pass).toBe(true);
  expect(gated?.expectsActions).toBe(true);
  expect(
    (gated?.stageOutputs?.jevSelect as { gates?: unknown } | undefined)?.gates,
  ).toMatchObject({
    needsActions: { answer: 'yes', probability: 0.8 },
    spatial: { answer: 'no', probability: 0.3 },
  });
  expect(gated?.answers).toContainEqual({
    stage: 'jevSelect',
    question: 'gate/spatial',
    choice: 'no',
    probability: 0.7,
    confidence: 0.4,
  });
  expect(gated?.jevCalls?.map((call) => call.stage)).toEqual([
    'jevSelect',
    'jevActions',
    'jevActions',
    'jevLayout',
  ]);
});

test('records every answer and confidence on a turn a stage deferred', async () => {
  mockProvider();
  const records = await run(
    conversation({ actions: [{ pick: 'unsupported' }] }),
    ['hide'],
  );
  const jev = records[1];
  expect(jev?.deferral?.reason).toBe('jevActions/action_unsupported');
  expect(jev?.fallbackCalls).toBe(1);
  expect(jev?.llmCalls?.map((call) => call.role)).toEqual(['fallback']);
  expect(jev?.answers).toContainEqual({
    stage: 'jevActions',
    question: 'action/0',
    choice: 'unsupported',
    probability: 1,
    confidence: 1,
  });
  expect(jev?.answers?.some((answer) => answer.stage === 'jevSelect')).toBe(
    true,
  );
  expect(jev?.minConfidence).toBe(1);
});

test('replays recorded upstream stages and runs the rest live', async () => {
  mockProvider();
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out });

  const layoutOnly: Script = (payload) => {
    if (!('layout' in payload.questions))
      throw new Error('select and actions must be replayed');
    return { choices: { layout: 'preserve' } };
  };
  const records = await run(layoutOnly, ['quoted-location'], {
    replay: {
      source: await loadReplay(out, 'jev-poc'),
      stages: replayedStages('actions'),
    },
  });
  const [baseline, jev] = records;
  expect(baseline?.stages).toBe(undefined);
  expect(jev?.score?.pass).toBe(true);
  expect(
    jev?.stages?.map((stage) => [stage.stage, stage.replayed ?? false]),
  ).toEqual([
    ['jevSelect', true],
    ['jevActions', true],
    ['jevLayout', false],
    ['llmComplete', false],
  ]);
  expect(jev?.jevCalls?.map((call) => call.stage)).toEqual(['jevLayout']);
});

test('runs jev-ungated-stepwise like the POC today: same stages, scores and calls', async () => {
  mockProvider();
  const out = await outDir();
  const [poc, stepwise] = await run(tokyo, ['quoted-location'], {
    arms: resolveArms(['jev-poc', 'jev-ungated-stepwise']),
    out,
  });
  expect(stepwise?.kind).toBe('jev');
  expect(stepwise?.score).toEqual(poc?.score);
  expect(stepwise?.stageScores).toEqual(poc?.stageScores);
  expect(stepwise?.stageOutputs).toEqual({
    ...poc?.stageOutputs,
    jevLayout: {
      source: 'jev',
      ...(poc?.stageOutputs?.jevLayout as object),
    },
  });
  expect(stepwise?.answers).toEqual(poc?.answers);
  expect(stepwise?.minConfidence).toBe(poc?.minConfidence);
  expect(stepwise?.llmCalls?.map((call) => call.role)).toEqual(['complete']);
  expect(stepwise?.stages?.map((stage) => stage.stage)).toEqual(
    poc?.stages?.map((stage) => stage.stage),
  );
  expect(stepwise?.userMessage).toBe(poc?.userMessage);
  expect(stepwise?.tree).toEqual(poc?.tree);
  const stageFile = JSON.parse(
    await readFile(
      join(out, 'stages', 'jev-ungated-stepwise', 'quoted-location-1.json'),
      'utf8',
    ),
  );
  expect(stageFile.stages[2].output.source).toBe('jev');
});

test('replays a jev-poc selection into jev-ungated-stepwise', async () => {
  mockProvider();
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out });

  const [stepwise] = await run(
    ((payload, call) => {
      if ('scope' in payload.questions)
        throw new Error('select must be replayed');
      return tokyo(payload, call);
    }) satisfies Script,
    ['quoted-location'],
    {
      arms: resolveArms(['jev-ungated-stepwise']),
      replay: {
        source: await loadReplay(out, 'jev-poc'),
        stages: replayedStages('select'),
      },
    },
  );
  expect(stepwise?.score?.pass).toBe(true);
  expect(
    stepwise?.stages?.map((stage) => [stage.stage, stage.replayed ?? false]),
  ).toEqual([
    ['jevSelect', true],
    ['jevActions', false],
    ['jevLayout', false],
    ['llmComplete', false],
  ]);
});

test('refuses to replay jev-poc action plans into stage-library arms before any call', async () => {
  mockProvider();
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out });
  mockChat.mockClear();

  const noCalls: Script = () => {
    throw new Error('no Jev call may run');
  };
  const source = await loadReplay(out, 'jev-poc');
  await expect(
    run(noCalls, ['quoted-location'], {
      arms: resolveArms(['jev-ungated-stepwise']),
      replay: { source, stages: replayedStages('actions') },
    }),
  ).rejects.toThrow(
    '- jev-ungated-stepwise: jevActions has no minConfidence (1 turns: quoted-location #1)',
  );
  await expect(
    run(noCalls, ['quoted-location'], {
      arms: resolveArms(['jev-gated-batched']),
      replay: { source, stages: replayedStages('select') },
    }),
  ).rejects.toThrow('- jev-gated-batched: jevSelect has no complete gates');
  expect(mockChat).not.toHaveBeenCalled();
});

test('refuses a replay missing a selected case before any provider call', async () => {
  mockProvider();
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out });
  mockChat.mockClear();

  const noCalls: Script = () => {
    throw new Error('no Jev call may run');
  };
  await expect(
    run(noCalls, ['quoted-location', 'ambiguous'], {
      replay: {
        source: await loadReplay(out, 'jev-poc'),
        stages: replayedStages('actions'),
      },
    }),
  ).rejects.toThrow('ambiguous #1: no recorded turn');
  expect(mockChat).not.toHaveBeenCalled();
});

test('a layout stage that hands the tree to the LLM is scored on the shipped response only', async () => {
  mockProvider();
  const [record] = await run(tokyo, ['quoted-location'], {
    arms: [handOffArm],
  });
  expect(record?.error).toBe(undefined);
  expect(record?.fallbackCalls).toBe(0);
  expect(record?.llmCalls?.map((call) => call.role)).toEqual(['complete']);
  expect(record?.stageScores?.layout).toBe(undefined);
  expect(record?.stageScores?.selection?.pass).toBe(true);
  expect(record?.score?.pass).toBe(true);
  expect(record?.stageOutputs?.jevLayout).toMatchObject({
    source: 'llm',
    tree: undefined,
  });
});

/** The stage-library pipeline, its layout stage dropping the tree so the completion call writes it. */
const handOffArm: Arm = {
  name: 'jev-hand-off',
  kind: 'jev',
  build: (deps) => {
    const jev = jevDeps(deps);
    const menu = menuLayout(jev.ask);
    const handOff: LayoutStage = async (plan, ctx) => {
      const result = await menu(plan, ctx);
      if (isErr(result)) return result;
      const { tree: _tree, layoutId: _layoutId, ...rest } = result.value;
      return ok({ ...rest, source: 'llm' });
    };
    return withFallback(
      pipeline(
        deps.instrument('jevSelect', selectUngated(jev.ask)),
        deps.instrument('jevActions', stepwiseActions(jev.ask)),
        deps.instrument('jevLayout', handOff),
        deps.instrument('llmComplete', completeWithLayout(jev.llm)),
      ),
      withRetry(jev.fallback, { max: FALLBACK_RETRIES }),
    );
  },
};

const gradedTokyo: Script = (payload, call) =>
  'request_satisfied' in payload.questions
    ? {
        choices: {},
        scores: { request_satisfied: 4, arrangement_match: 3 },
      }
    : tokyo(payload, call);

test('grades every planned shipped response after the turn, its calls kept apart from the arm', async () => {
  mockProvider();
  const records = await run(gradedTokyo, ['quoted-location', 'ambiguous'], {
    grader: true,
  });
  const [baseline, jev, baselineDeferral, jevDeferral] = records;
  for (const record of [baseline, jev]) {
    expect(record?.grader?.dimensions).toEqual({
      request_satisfied: { score: 1, samples: [4] },
      arrangement_match: { score: 0.75, samples: [3] },
    });
    expect(record?.grader?.calls).toMatchObject([
      { outcome: 'ok', usage: { inputTokens: 11, outputTokens: 2 } },
    ]);
  }
  expect(jev?.jevCalls?.some((call) => call.stage === 'grader')).toBe(false);
  expect(jev?.answers?.some((answer) => answer.stage === 'grader')).toBe(false);
  expect(baseline?.executionPlan as unknown).toEqual([
    {
      instanceId: 'weather-main',
      action: 'setLocation',
      params: { location: 'Tokyo' },
    },
  ]);
  expect(
    baseline?.instances?.map((instance) => String(instance.instanceId)),
  ).toEqual([
    'calendar-main',
    'weather-main',
    'tasks-main',
    'map-main',
    'journal-main',
  ]);
  // Expected-deferral scenarios are left out of every planned metric.
  expect(baselineDeferral?.grader).toBe(undefined);
  expect(jevDeferral?.grader).toBe(undefined);
});

test('a grader failure is recorded without touching the turn', async () => {
  mockProvider();
  const [baseline, jev] = await run(
    (payload, call) =>
      'request_satisfied' in payload.questions
        ? { status: 500 }
        : tokyo(payload, call),
    ['quoted-location'],
    { grader: true },
  );
  for (const record of [baseline, jev]) {
    expect(record?.error).toBe(undefined);
    expect(record?.score?.pass).toBe(true);
    expect(record?.grader?.failure).toBe('grader/provider_http');
    expect(record?.grader?.calls).toMatchObject([{ outcome: 'provider_http' }]);
  }
  expect(jev?.fallbackCalls).toBe(0);
  expect(jev?.deferral).toBe(undefined);
});

test('grade catches an exception ask raises and records grader/exception, never throwing', async () => {
  const [scenario] = selectScenarios('development', ['quoted-location']);
  if (!scenario) throw new Error('fixture scenario is missing');
  const throwingAsk: Ask = () => {
    throw new Error('boom');
  };
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
    grade(throwingAsk, scenario, response, silentLogger),
  ).resolves.toEqual({
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    failure: 'grader/exception',
  });
});

test('does not grade without the grader option', async () => {
  mockProvider();
  const [baseline, jev] = await run(gradedTokyo, ['quoted-location']);
  expect(baseline?.grader).toBe(undefined);
  expect(jev?.grader).toBe(undefined);
});
