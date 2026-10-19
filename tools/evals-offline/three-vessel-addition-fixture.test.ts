import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { validateLoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import {
  scoreThreeVesselAddition,
  threeVesselAdditionDataSchema,
  threeVesselAdditionObservationSchema,
} from '../../packages/evals/src/adapters/three-vessel-addition.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { VesselSchema } from '../../packages/protocol/src/index.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D35 fixtures');
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
    ({ definition }) => definition.id === 'three-vessel-addition',
  );
  if (!item || item.definition.profile !== 'three-vessel-addition')
    throw new Error('Missing D35');
  const definition = item.definition;
  const data = threeVesselAdditionDataSchema.parse(item.fixture.data);
  const turns = threeVesselAdditionObservationSchema.parse(
    data.responses.map((response, index) => ({
      index,
      input: definition.inputs.turns[index],
      state: index
        ? { layout: data.responses[index - 1].layout }
        : data.initial,
      output: response,
      resultingState: { layout: response.layout },
    })),
  );
  return {
    item: { ...item, definition },
    data,
    turns,
    score: (value: unknown) =>
      scoreThreeVesselAddition(
        value,
        data.initial,
        data.catalog,
        item.definition.inputs,
        item.definition.expectations,
      ),
  };
}

test('D35 pins the adjudicated Weather-only start, exact dataset prompts and post-addition preservation baseline', async () => {
  const { item, turns, score } = example();
  expect(item.definition.lineage[0]).toMatchObject({
    pointer: '/items/34',
    taskId: 'cap-maelstrom-multivessel-three',
  });
  expect(item.definition.review).toBe('pending-human-review');
  expect(item.definition.title).toContain('COMPLETE');
  for (const caveat of [
    'only for the user-adjudicated current contract',
    'one fresh post-fix current-Engine sample passed',
    'prior failures remain preserved',
    'not reliability or user semantic acceptance',
    'No clinical data/trend fulfillment or client/handler effects',
    'legacy TASK_DEFINITIONS',
    'no source scorer/runtime equivalence',
  ])
    expect(item.definition.purpose).toContain(caveat);
  expect(item.definition.expectations).toEqual({
    coverage: 'COMPLETE',
    initialScene: 'weather-only',
    labsPreservationBaseline: 'after-addition',
    weatherAction: 'showWeekly',
    calendarAction: 'showWeek',
  });
  for (const coverage of ['PARTIAL', 'FULL', undefined]) {
    const changed = structuredClone(item);
    Object.assign(changed.definition.expectations, { coverage });
    expect(() => validateLoadedCase(changed)).toThrow();
  }
  expect(score(turns).outcome).toBe('pass');
  const result = await evaluateSample(
    {
      runId: 'd35-offline',
      caseId: item.definition.id,
      runtimeId: item.definition.profile,
      sample: 1,
    },
    caseAdapter(item),
  );
  expect(result.evaluation).toBe('pass');
  expect(result.provenance).toContain('user-adjudicated');
  expect(result.provenance).toContain(
    'COMPLETE only for the adjudicated current contract',
  );
  expect(result.provenance).toContain('not legacy scorer/runtime equivalence');
});

test('D35 frozen catalog matches actual current demo definitions, not legacy Calendar action spelling', async () => {
  const { data } = example();
  const actual = [];
  for (const name of ['weather', 'labs', 'calendar']) {
    const value = await import(
      new URL(
        `../../apps/demo/src/vessels/${name}.vessel.def.ts`,
        import.meta.url,
      ).href
    );
    actual.push(VesselSchema.parse(value[`${name}Vessel`]));
  }
  expect(data.catalog).toEqual(actual);
});

test('D35 requires Weather-only initial state and rejects stale preloaded or altered catalog contracts', () => {
  const { data } = example();
  for (const extra of [
    { instanceId: 'labs-main', vesselId: 'labs', variant: 'trends' },
    { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
  ])
    expect(
      threeVesselAdditionDataSchema.safeParse({
        ...data,
        initial: {
          layout: {
            ...data.initial.layout,
            instances: [...data.initial.layout.instances, extra],
          },
        },
      }).success,
    ).toBe(false);
  const changed = structuredClone(data);
  changed.catalog[2].defaultVariant = changed.catalog[0].defaultVariant;
  expect(threeVesselAdditionDataSchema.safeParse(changed).success).toBe(false);
});

test('D35 detects missing/extra/foreign/duplicated members, premature transitions and lost Labs on every turn', () => {
  const { turns, score } = example();
  for (let index = 0; index < 3; index++)
    for (const target of [0, 1, 2])
      for (const field of ['instanceId', 'vesselId', 'variant'] as const) {
        const changed = structuredClone(turns);
        changed[index].output.layout.instances[target][field] = 'wrong';
        changed[index].resultingState.layout = structuredClone(
          changed[index].output.layout,
        );
        expect(score(changed).outcome).toBe('fail');
      }
  for (let index = 0; index < 3; index++) {
    for (const members of [
      turns[index].output.layout.instances.slice(1),
      [
        ...turns[index].output.layout.instances,
        turns[index].output.layout.instances[0],
      ],
    ]) {
      const changed = structuredClone(turns);
      changed[index].output.layout.instances = members;
      expect(score(changed).outcome).toBe('fail');
    }
  }
});

test('D35 requires correctly timed Weather/showWeekly and Calendar/showWeek despite correct layouts', () => {
  const { turns, score } = example();
  for (const index of [1, 2])
    for (const plan of [
      [],
      [{ instanceId: 'other', action: 'showWeekly' }],
      [
        {
          instanceId: index === 1 ? 'weather-main' : 'calendar-main',
          action: index === 1 ? 'showWeek' : 'showWeekly',
        },
      ],
    ]) {
      const changed = structuredClone(turns);
      changed[index].output.executionPlan = plan;
      expect(score(changed).outcome).toBe('fail');
    }
  for (const [index, step] of [
    [0, { instanceId: 'weather-main', action: 'showWeekly' }],
    [1, { instanceId: 'calendar-main', action: 'showWeek' }],
    [2, { instanceId: 'weather-main', action: 'showCurrent' }],
  ] as const) {
    const changed = structuredClone(turns);
    changed[index].output.executionPlan.push(step);
    expect(score(changed).outcome).toBe('fail');
  }
});

test('D35 does not require an empty creation plan; valid extra non-transition Actions/params are unscored', () => {
  const { turns, score } = example();
  for (const turn of turns)
    turn.output.executionPlan.push({
      instanceId: 'weather-main',
      action: 'setLocation',
      params: { arbitrary: ['unscored'] },
    });
  turns[0].output.executionPlan.push({
    instanceId: 'labs-main',
    action: 'selectMarker',
    params: { markerSlug: 'hemoglobin' },
  });
  expect(score(turns).outcome).toBe('pass');
  for (const index of [1, 2]) {
    const changed = structuredClone(turns);
    changed[index].output.executionPlan.push({
      instanceId: 'labs-main',
      action: 'selectMarker',
      params: { markerSlug: 'hemoglobin' },
    });
    expect(score(changed).outcome).toBe('fail');
  }
});

test('D35 validates incoming Actions sequentially and rejects foreign or unavailable steps', () => {
  const { turns, score } = example();
  for (const step of [
    { instanceId: 'other', action: 'setLocation' },
    { instanceId: 'weather-main', action: 'bogus' },
    { instanceId: 'weather-main', action: 'showWeekly' },
  ]) {
    const changed = structuredClone(turns);
    changed[1].output.executionPlan.push(step);
    expect(score(changed).outcome).toBe('fail');
  }
});

test('D35 fails closed on malformed, missing, extra, reordered and discontinuous evidence; instance order is not geometry', () => {
  const { turns, score } = example();
  for (const value of [
    undefined,
    [],
    turns.slice(1),
    [...turns, turns[2]],
    [turns[1], turns[0], turns[2]],
  ])
    expect(score(value).outcome).toBe('fail');
  for (const change of [
    (t: typeof turns) => {
      t[1].state.layout.instances[0].variant = 'weekly';
    },
    (t: typeof turns) => {
      t[2].resultingState.layout.instances.pop();
    },
    (t: typeof turns) => {
      t[0].input.intent = 'other';
    },
    (t: typeof turns) => {
      t[1].output.layout.type = 'grid';
    },
  ]) {
    const changed = structuredClone(turns);
    change(changed);
    expect(score(changed).outcome).toBe('fail');
  }
  for (const turn of turns)
    for (const state of [turn.state, turn.output, turn.resultingState])
      state.layout.instances.reverse();
  expect(score(turns).outcome).toBe('pass');
});

test('D35 strict loader rejects changed source lineage/prompt/rules/kind and bounds evidence', () => {
  const { item, data } = example();
  for (const change of [
    (v: typeof item) => {
      Object.assign(v.definition.lineage[0], { pointer: '/items/35' });
    },
    (v: typeof item) => {
      Object.assign(v.definition.inputs.turns[0], { intent: 'invented' });
    },
    (v: typeof item) => {
      Object.assign(v.definition.expectations, { initialScene: 'preloaded' });
    },
    (v: typeof item) => {
      v.fixture.kind = 'cross-vessel-script';
    },
  ]) {
    const changed = structuredClone(item);
    change(changed);
    expect(() => validateLoadedCase(changed)).toThrow();
  }
  const changed = structuredClone(data);
  changed.responses[0].executionPlan = Array(21).fill({
    instanceId: 'weather-main',
    action: 'setLocation',
  });
  expect(threeVesselAdditionDataSchema.safeParse(changed).success).toBe(false);
});

test('D35 independent fixture mutations affect verdicts and samples reset; expectations cannot manufacture additions', async () => {
  const { item } = example();
  const adapter = caseAdapter(item);
  const run = () =>
    evaluateSample(
      {
        runId: 'd35-independent',
        caseId: item.definition.id,
        runtimeId: item.definition.profile,
        sample: 1,
      },
      adapter,
    );
  const first = await run();
  const observed = first.observation as Array<{
    output: { layout: { instances: unknown[] } };
  }>;
  observed[0].output.layout.instances.length = 0;
  expect((await run()).evaluation).toBe('pass');
  const changed = structuredClone(item);
  const data = threeVesselAdditionDataSchema.parse(changed.fixture.data);
  data.responses[1].executionPlan = [];
  changed.fixture.data = data;
  expect(
    (
      await evaluateSample(
        {
          runId: 'd35-mutant',
          caseId: item.definition.id,
          runtimeId: item.definition.profile,
          sample: 1,
        },
        caseAdapter(changed),
      )
    ).evaluation,
  ).toBe('fail');
});
