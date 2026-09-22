import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pipeline, withFallback, withRetry } from '@maelstrom-co/engine';
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
import { type Arm, jevDeps, resolveArms } from './arms.js';
import { loadReplay, replayedStages } from './replay.js';
import { writeReport } from './report.js';
import { runEval } from './run.js';
import { selectScenarios } from './scenarios.js';

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

test('replays jev-poc stages into jev-ungated-stepwise', async () => {
  mockProvider();
  const out = await outDir();
  await run(tokyo, ['quoted-location'], { out });

  const layoutOnly: Script = (payload) => {
    if (!('layout' in payload.questions))
      throw new Error('select and actions must be replayed');
    return { choices: { layout: 'preserve' } };
  };
  const [stepwise] = await run(layoutOnly, ['quoted-location'], {
    arms: resolveArms(['jev-ungated-stepwise']),
    replay: {
      source: await loadReplay(out, 'jev-poc'),
      stages: replayedStages('actions'),
    },
  });
  expect(stepwise?.score?.pass).toBe(true);
  expect(
    stepwise?.stages?.map((stage) => [stage.stage, stage.replayed ?? false]),
  ).toEqual([
    ['jevSelect', true],
    ['jevActions', true],
    ['jevLayout', false],
    ['llmComplete', false],
  ]);
  expect(stepwise?.jevCalls?.map((call) => call.stage)).toEqual(['jevLayout']);
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
