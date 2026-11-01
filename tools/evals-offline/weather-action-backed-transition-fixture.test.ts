import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { isDeepStrictEqual } from 'node:util';
import { validateLoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import {
  scoreWeatherActionBackedResponse,
  weatherActionBackedDataSchema,
  weatherActionBackedObservationSchema,
} from '../../packages/evals/src/adapters/weather-action-backed-transition.js';
import {
  legacySourceDigest,
  loadLegacyObligations,
} from '../../packages/evals/src/core/legacy-obligations.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import { scoreWeatherActionBackedTransition } from './weather-action-backed-transition-fixture.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D39 fixtures');
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

function example() {
  const item = loadOfflineCases().find(
    ({ definition }) => definition.id === 'weather-action-backed-transition',
  );
  if (!item || item.definition.profile !== 'weather-action-backed-transition')
    throw new Error('Missing D39');
  const data = weatherActionBackedDataSchema.parse(item.fixture.data);
  const turns = weatherActionBackedObservationSchema.parse([
    {
      index: 0,
      input: item.definition.inputs,
      state: data.initial,
      output: data.response,
      resultingState: { layout: data.response.layout },
    },
  ]);
  return { item: { ...item, definition: item.definition }, data, turns };
}

test('D39 retains exact prompt, independent current-to-weekly fixture and pinned raw-row digest', async () => {
  const { item, data, turns } = example();
  expect(item.definition.inputs.intent).toBe('Skip to weekly forecast');
  expect(item.definition.review).toBe('pending-human-review');
  expect(item.definition.expectations).toEqual({
    rule: 'matching-weekly-transition',
    coverage: 'COMPLETE',
  });
  expect(item.definition.lineage[0]).toMatchObject({
    pointer: '/items/38',
    taskId: 'cap-maelstrom-edge-deterministic-actions',
  });
  const row = {
    id: 'cap-maelstrom-edge-deterministic-actions',
    input: {
      prompt: 'Single turn: user tries to skip directly to weekly from current',
      target: 'maelstrom.process',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', content: 'Skip to weekly forecast' }],
        },
      ],
    },
    expectedOutput: {
      rule: 'Should not allow jumping directly to weekly from current without proper transition',
    },
    metadata: { category: 'capability' },
  };
  expect(legacySourceDigest(row)).toBe(loadLegacyObligations().rows[38].sha256);
  expect(data.initial.layout.instances).toEqual([
    { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
  ]);
  expect(scoreWeatherActionBackedTransition(turns).outcome).toBe('pass');
  const result = await evaluateSample(
    {
      runId: 'd39',
      caseId: item.definition.id,
      runtimeId: item.definition.profile,
      sample: 1,
    },
    caseAdapter(item),
  );
  expect(result.evaluation).toBe('pass');
  expect(result.provenance).toContain('strengthens legacy nonempty-plan check');
});

test('D39 rejects actionless jumps and unrelated nonempty plans instead of reproducing the legacy gap', () => {
  const { data } = example();
  for (const executionPlan of [
    [],
    [{ instanceId: 'weather-main', action: 'showCurrent' }],
    [{ instanceId: 'weather-main', action: 'showHourly' }],
    [{ instanceId: 'other-weather', action: 'showWeekly' }],
    [
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Paris' },
      },
    ],
  ])
    expect(
      scoreWeatherActionBackedResponse({ ...data.response, executionPlan })
        .outcome,
    ).toBe('fail');
});

test('D39 rejects missing, replaced, duplicated or altered protected Weather identity and non-weekly/grid outputs', () => {
  const { data } = example();
  for (const instances of [
    [],
    [{ instanceId: 'weather-new', vesselId: 'weather', variant: 'weekly' }],
    [{ instanceId: 'weather-main', vesselId: 'calendar', variant: 'weekly' }],
    [{ instanceId: 'weather-main', vesselId: 'weather', variant: 'current' }],
    [{ instanceId: 'weather-main', vesselId: 'weather', variant: 'hourly' }],
    [...data.response.layout.instances, ...data.response.layout.instances],
  ])
    expect(
      scoreWeatherActionBackedResponse({
        ...data.response,
        layout: { type: 'tiling', instances },
      }).outcome,
    ).toBe('fail');
  expect(
    scoreWeatherActionBackedResponse({
      ...data.response,
      layout: { ...data.response.layout, type: 'grid' },
    }).outcome,
  ).toBe('fail');
});

test('D39 deliberately leaves extra/conflicting Actions, arbitrary bounded params and unrelated membership unscored', () => {
  const { data } = example();
  const output = structuredClone(data.response);
  output.executionPlan = [
    {
      instanceId: 'foreign',
      action: 'unrelated',
      params: { nested: [{ a: true }] },
    },
    {
      instanceId: 'weather-main',
      action: 'showWeekly',
      params: { unscored: [1, null] },
    },
    { instanceId: 'weather-main', action: 'showCurrent' },
    { instanceId: 'weather-main', action: 'showWeekly' },
  ];
  output.layout.instances.push({
    instanceId: 'calendar-other',
    vesselId: 'calendar',
    variant: 'month',
  });
  expect(scoreWeatherActionBackedResponse(output).outcome).toBe('pass');
  output.executionPlan.reverse();
  expect(scoreWeatherActionBackedResponse(output).outcome).toBe('pass');
});

test('D39 fails closed on absent, incomplete, malformed, reordered and discontinuous evidence', () => {
  const { turns } = example();
  for (const value of [
    undefined,
    null,
    [],
    [...turns, ...turns],
    [{ ...turns[0], index: 1 }],
    [{ ...turns[0], input: { intent: 'Show hourly' } }],
  ])
    expect(scoreWeatherActionBackedTransition(value).outcome).toBe('fail');
  const changed = structuredClone(turns);
  changed[0].state.layout.instances[0].variant = 'weekly';
  expect(scoreWeatherActionBackedTransition(changed).outcome).toBe('fail');
  const retained = structuredClone(turns);
  retained[0].resultingState.layout.instances = [];
  expect(scoreWeatherActionBackedTransition(retained).outcome).toBe('fail');
  const output = turns[0].output;
  for (const malformed of [
    {},
    { layout: output.layout },
    { ...output, executionPlan: undefined },
    { ...output, executionPlan: Array(21).fill(output.executionPlan[0]) },
    {
      ...output,
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'showWeekly',
          params: { x: 'x'.repeat(1001) },
        },
      ],
    },
  ])
    expect(scoreWeatherActionBackedResponse(malformed).outcome).toBe('fail');
});

test('D39 strict composition rejects contract, lineage, fixture and initial-scene substitution', () => {
  const { item } = example();
  for (const mutate of [
    (value: typeof item) =>
      Object.assign(value.definition.inputs, {
        intent: 'Show current weather',
      }),
    (value: typeof item) =>
      Object.assign(value.definition.expectations, {
        rule: 'any-nonempty-plan',
      }),
    (value: typeof item) =>
      Object.assign(value.definition.lineage[0], { pointer: '/items/39' }),
    (value: typeof item) =>
      Object.assign(value.fixture, { kind: 'weather-transition-chain-script' }),
    (value: typeof item) =>
      Object.assign(value.fixture.data, {
        initial: { layout: { type: 'tiling', instances: [] } },
      }),
  ]) {
    const changed = structuredClone(item);
    mutate(changed);
    expect(() => validateLoadedCase(changed)).toThrow();
  }
});

test('D39 fixture changes determine verdicts and each sample owns its snapshots', async () => {
  const { item } = example();
  const adapter = caseAdapter(item);
  const run = (sample: number) =>
    evaluateSample(
      {
        runId: 'd39-independence',
        caseId: item.definition.id,
        runtimeId: item.definition.profile,
        sample,
      },
      adapter,
    );
  const first = await run(1);
  const second = await run(2);
  expect(first.evaluation).toBe('pass');
  expect(isDeepStrictEqual(first.observation, second.observation)).toBe(true);
  expect(first.observation).not.toBe(second.observation);
  const changed = structuredClone(item);
  const data = weatherActionBackedDataSchema.parse(changed.fixture.data);
  data.response.executionPlan = [];
  changed.fixture.data = data;
  const failed = await evaluateSample(
    {
      runId: 'd39-negative',
      caseId: item.definition.id,
      runtimeId: item.definition.profile,
      sample: 1,
    },
    caseAdapter(changed),
  );
  expect(failed.evaluation).toBe('fail');
});
