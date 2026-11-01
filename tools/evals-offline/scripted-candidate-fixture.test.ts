import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { getScenario } from '../../packages/evals/src/adapters/offline-case.js';
import {
  type ScriptedCandidateData,
  scriptedCandidateDataSchema,
} from '../../packages/evals/src/adapters/scripted-candidate.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { scoreResponse } from '../../packages/evals/src/core/score.js';
import {
  ActionName,
  InstanceId,
  MessageId,
  VariantName,
} from '../../packages/protocol/src/index.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import { scriptedCandidate } from './scripted-candidate-fixture.js';

const identity = {
  runId: 'scripted-candidate-controls',
  caseId: 'scripted-variant',
  runtimeId: 'real-engine-scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in scripted-candidate controls');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
function documents() {
  const item = loadOfflineCases().find(
    (item) => item.definition.id === 'scripted-variant',
  );
  if (!item || item.definition.profile !== 'scripted-candidate')
    throw new Error('Missing scripted candidate');
  return { item, data: scriptedCandidateDataSchema.parse(item.fixture.data) };
}
function rawScore(data: ScriptedCandidateData) {
  return scoreResponse(getScenario('variant'), {
    ...data.candidate,
    type: 'maelstrom_response',
    requestId: MessageId('raw-control'),
    layout: { type: 'tiling', ...data.candidate.layout },
  });
}

test('scripted variant is JSON-backed real Engine/scorer integration with no model, staged calls or fake usage', async () => {
  const { item, data } = documents();
  expect(item.definition).toMatchObject({
    scenarioId: 'variant',
    surface: 'planner-response',
    migration: 'json-backed',
    expectations: {
      status: 'planned',
      actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    },
    review: 'pending-human-review',
    lineage: [
      {
        source: 'current',
        revision: '3654af466efd935cf07da95f6751d36a9bb07377',
        path: 'packages/evals/src/core/scenarios.ts',
        scenarioId: 'variant',
      },
    ],
  });
  expect(getScenario('variant').request.context.updateReasons).toContainEqual({
    type: 'user_intent',
    intent: 'Show the weekly forecast in the weather widget.',
  });
  expect(data.candidate.executionPlan).toEqual([
    {
      instanceId: InstanceId('weather-main'),
      action: ActionName('showWeekly'),
    },
  ]);
  const result = await evaluateSample(
    identity,
    scriptedCandidate(data, item.definition),
  );
  expect(result.execution).toBe('completed');
  expect(result.evaluation).toBe('pass');
  expect(result.provenance).toContain(
    'real-engine/scripted-candidate/no-model',
  );
  expect(result.observation).toMatchObject({
    scenarioId: 'variant',
    arm: 'fake-baseline',
    llmCalls: [],
    executionPlan: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    score: { pass: true, failures: [] },
  });
  for (const field of ['stages', 'fakeCalls', 'fallbackCalls', 'grader'])
    expect(result.observation?.[field]).toBeUndefined();
  expect(result.records.map((record) => record.kind)).toEqual([
    'diagnostic',
    'turn',
  ]);
  expect(result.records[0]).toMatchObject({
    producer: 'scripted-candidate',
    value: data,
  });
  expect(result.records[1].value).toEqual(result.observation);
  expect((await evaluateSample(identity, caseAdapter(item))).evaluation).toBe(
    'pass',
  );
});

test('scripted candidate missing/wrong Actions fail the unchanged scenario scorer despite a weekly candidate layout', async () => {
  for (const action of [undefined, 'showHourly', 'inventedAction']) {
    const { item, data } = documents();
    const sourceExpected = structuredClone(getScenario('variant').expected);
    if (action === undefined) data.candidate.executionPlan = [];
    else data.candidate.executionPlan[0].action = ActionName(action);
    const result = await evaluateSample(
      identity,
      scriptedCandidate(data, item.definition),
    );
    expect(result.execution).toBe('completed');
    expect(result.evaluation).toBe('fail');
    expect(result.observation?.score?.pass).toBe(false);
    expect(
      result.failures.some((failure) => failure.startsWith('Ordered actions:')),
    ).toBe(true);
    expect(
      result.failures.some((failure) =>
        failure.startsWith('Variant of weather-main'),
      ),
    ).toBe(true);
    expect(result.records[0].value).toEqual(data);
    expect(getScenario('variant').expected).toEqual(sourceExpected);
    if (action === 'inventedAction')
      expect(result.observation?.executionPlan).toEqual([]);
  }
});

test('Engine removes an invalid extra Action: raw candidate fails but shipped response passes', async () => {
  const { item, data } = documents();
  const malformed = scriptedCandidateDataSchema.parse({
    candidate: {
      ...data.candidate,
      executionPlan: [
        ...data.candidate.executionPlan,
        { instanceId: 'weather-main', action: 'inventedAction' },
      ],
    },
  });
  expect(rawScore(malformed).pass).toBe(false);
  const result = await evaluateSample(
    identity,
    scriptedCandidate(malformed, item.definition),
  );
  expect(result.execution).toBe('completed');
  expect(result.evaluation).toBe('pass');
  expect(result.observation?.executionPlan).toEqual(
    data.candidate.executionPlan,
  );
  expect(result.observation?.score).toEqual({ pass: true, failures: [] });
  expect(result.records[0].value).toEqual(malformed);
  expect(malformed.candidate.executionPlan).toHaveLength(2);
});

test('Engine repairs weighted syntax while preserving separate raw candidate and shipped tree evidence', async () => {
  const { item, data } = documents();
  data.candidate.layout.tree = scriptedCandidateDataSchema.parse({
    candidate: {
      ...data.candidate,
      layout: {
        ...data.candidate.layout,
        tree: [
          'V:1,x,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
      },
    },
  }).candidate.layout.tree;
  const result = await evaluateSample(
    identity,
    scriptedCandidate(data, item.definition),
  );
  expect(result.evaluation).toBe('pass');
  expect(result.records[0].value).toEqual(data);
  expect(result.observation?.tree).toEqual([
    'V:1,1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ]);
  expect(result.observation?.tree).not.toEqual(data.candidate.layout.tree);
});

test('scripted candidates do not introduce a raw-Variant oracle beyond the unchanged scenario invariant', async () => {
  const { item, data } = documents();
  data.candidate.layout.instances[1].variant = VariantName('current');
  const result = await evaluateSample(
    identity,
    scriptedCandidate(data, item.definition),
  );
  expect(result.evaluation).toBe('fail');
  expect(
    result.observation?.instances?.find(
      (item) => item.instanceId === 'weather-main',
    )?.variant,
  ).toBe(VariantName('current'));
  expect(result.failures).toContain(
    'Variant of weather-main is current, but the execution plan leaves it weekly',
  );
});

test('scripted candidate schema bounds raw output without semantic healing or silent field stripping', () => {
  const { data } = documents();
  const candidate = data.candidate;
  for (const invalid of [
    {},
    { candidate: { ...candidate, executionPlan: undefined } },
    { candidate: { ...candidate, userMessage: 'x'.repeat(2001) } },
    { candidate: { ...candidate, rationale: 'x'.repeat(2001) } },
    {
      candidate: {
        ...candidate,
        executionPlan: Array(21).fill(candidate.executionPlan[0]),
      },
    },
    {
      candidate: {
        ...candidate,
        executionPlan: [{ instanceId: 'x'.repeat(121), action: 'showWeekly' }],
      },
    },
    {
      candidate: {
        ...candidate,
        executionPlan: [
          { instanceId: 'weather-main', action: 'showWeekly', params: {} },
        ],
      },
    },
    {
      candidate: {
        ...candidate,
        executionPlan: [
          {
            instanceId: 'weather-main',
            action: 'showWeekly',
            paramsJson: 'x'.repeat(4001),
          },
        ],
      },
    },
    {
      candidate: {
        ...candidate,
        layout: {
          ...candidate.layout,
          instances: Array(21).fill(candidate.layout.instances[0]),
        },
      },
    },
    {
      candidate: {
        ...candidate,
        layout: { ...candidate.layout, tree: Array(257).fill(null) },
      },
    },
    {
      candidate: {
        ...candidate,
        layout: { ...candidate.layout, tree: ['V:'.padEnd(257, '1')] },
      },
    },
    {
      candidate: {
        ...candidate,
        layout: { ...candidate.layout, tree: ['weather-main'] },
      },
    },
    {
      candidate: {
        ...candidate,
        layout: { ...candidate.layout, type: 'tiling' },
      },
    },
    { candidate: { ...candidate, layout: { positions: [] } } },
    { candidate: { ...candidate, execute: 'module' } },
    { ...data, module: 'remote' },
  ])
    expect(scriptedCandidateDataSchema.safeParse(invalid).success).toBe(false);
});

test('scripted candidate snapshots remain independent across samples and caller mutations', async () => {
  const { item, data } = documents();
  const subject = scriptedCandidate(data, item.definition);
  const snapshot = structuredClone(data);
  data.candidate.executionPlan = [];
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(first.evaluation).toBe('pass');
  expect(second.evaluation).toBe('pass');
  expect(first.records[0].value).toEqual(snapshot);
  expect(second.records[0].value).toEqual(snapshot);
  if (!first.observation || !second.observation)
    throw new Error('Missing shipped evidence');
  expect(second.observation).toEqual({
    ...first.observation,
    turnMs: second.observation.turnMs,
    repeat: 2,
  });
  expect(first.records[0].value).not.toBe(second.records[0].value);
});
