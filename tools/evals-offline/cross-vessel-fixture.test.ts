import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  crossVesselDataSchema,
  crossVesselExpectationsSchema,
  crossVesselResponseSchema,
} from '../../packages/evals/src/adapters/legacy-cross-vessel.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import { legacyCrossVessel } from './cross-vessel-fixture.js';

const identity = {
  runId: 'cross-vessel-controls',
  caseId: 'cross-vessel',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in cross-vessel controls');
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
    (item) => item.definition.id === 'cross-vessel',
  );
  if (!item || item.definition.profile !== 'legacy-cross-vessel')
    throw new Error('Missing D36 case');
  return {
    data: crossVesselDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = legacyCrossVessel(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing evidence');
  return { subject, turns: structuredClone([...result.observation]) };
}

test('D36 pins dataset requests, absence of initial Labs and the explicit labs-main/lab-results/trends mapping', async () => {
  const { data, inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Show me the hourly weather.',
    'Now show me my lab results.',
    'Switch the weather to weekly without touching labs.',
  ]);
  expect(data.registeredVessels).toEqual([
    'weather',
    'calendar',
    'lab-results',
  ]);
  expect(data.initial.layout.instances).toEqual([
    { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
  ]);
  expect(expected.labs).toEqual({
    instanceId: 'labs-main',
    vesselId: 'lab-results',
    variant: 'trends',
  });
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [{ instanceId: 'weather-main', action: 'showHourly' }],
    [],
    [{ instanceId: 'weather-main', action: 'showWeekly' }],
  ]);
  expect(turns[0].output.layout.instances).toHaveLength(2);
  for (const index of [1, 2])
    expect(turns[index].output.layout.instances[2]).toEqual(expected.labs);
  expect(turns[2].resultingState.layout).toEqual(turns[2].output.layout);
});

test('D36 requires Weather Actions at turns 0/2, not missing, wrong-target, wrong-name or mistimed steps', async () => {
  const { subject, turns } = await evidence();
  for (const index of [0, 2]) {
    for (const plan of [
      [],
      [
        {
          instanceId: 'foreign',
          action: turns[index].output.executionPlan[0].action,
        },
      ],
      [{ instanceId: 'weather-main', action: 'wrong' }],
      [
        {
          instanceId: 'weather-main',
          action: index === 0 ? 'showWeekly' : 'showHourly',
        },
      ],
    ]) {
      const changed = structuredClone(turns);
      changed[index].output.executionPlan = plan;
      expect(subject.score(changed).outcome).toBe('fail');
    }
    const moved = structuredClone(turns);
    moved[1].output.executionPlan = moved[index].output.executionPlan;
    moved[index].output.executionPlan = [];
    expect(subject.score(moved).outcome).toBe('fail');
  }
});

test('D36 checks first-match Weather/Calendar identity, Vessel and Variants across all response layouts', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const target of [0, 1]) {
      for (const [key, value] of [
        ['instanceId', 'replacement'],
        ['vesselId', 'wrong'],
        ['variant', 'wrong'],
      ] as const) {
        const changed = structuredClone(turns);
        changed[index].output.layout.instances[target][key] = value;
        expect(subject.score(changed).outcome).toBe('fail');
      }
      const missing = structuredClone(turns);
      missing[index].output.layout.instances.splice(target, 1);
      expect(subject.score(missing).outcome).toBe('fail');
    }
    const grid = structuredClone(turns);
    grid[index].output.layout.type = 'grid';
    expect(subject.score(grid).outcome).toBe('fail');
  }
});

test('D36 rejects premature Labs by ID or registered Vessel, and requires dataset Labs on turns 1/2', async () => {
  const { subject, turns } = await evidence();
  const { expected } = documents();
  for (const premature of [
    expected.labs,
    { ...expected.labs, instanceId: 'lab-results-main' },
    { ...expected.labs, vesselId: 'other' },
  ]) {
    const changed = structuredClone(turns);
    changed[0].output.layout.instances.push(premature);
    expect(subject.score(changed).failures).toContain(
      'Turn 0 must not introduce Labs before the request',
    );
  }
  for (const index of [1, 2]) {
    for (const [key, value] of [
      ['instanceId', 'lab-results-main'],
      ['vesselId', 'labs'],
      ['variant', 'summary'],
    ] as const) {
      const changed = structuredClone(turns);
      changed[index].output.layout.instances[2][key] = value;
      expect(subject.score(changed).outcome).toBe('fail');
    }
    const missing = structuredClone(turns);
    missing[index].output.layout.instances.pop();
    expect(subject.score(missing).outcome).toBe('fail');
  }
  const oldScorer = structuredClone(turns);
  for (const index of [1, 2]) {
    oldScorer[index].output.layout.instances[2].instanceId = 'lab-results-main';
    oldScorer[index].output.layout.instances[2].variant = 'summary';
  }
  expect(subject.score(oldScorer).outcome).toBe('fail');
});

test('D36 forbids Calendar-target Actions at 0/1 and every Labs-target Action at 2', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const action of ['showWeekly', 'showSummary', 'unverifiedAction']) {
      const changed = structuredClone(turns);
      changed[index].output.executionPlan.push({
        instanceId: index === 2 ? 'labs-main' : 'calendar-main',
        action,
      });
      expect(subject.score(changed).failures).toContain(
        `Turn ${index} contains a forbidden ${index === 2 ? 'Labs' : 'Calendar'} Action`,
      );
    }
  }
});

test('D36 permits unrelated/duplicate members with first-match behavior instead of exact-count rules', async () => {
  const { subject, turns } = await evidence();
  for (const turn of turns) {
    turn.output.layout.instances.reverse();
    const duplicates = turn.output.layout.instances.map((item) => ({
      ...item,
      vesselId: 'unscored',
      variant: 'wrong',
    }));
    turn.output.layout.instances.push(
      { instanceId: 'extra', vesselId: 'other', variant: 'other' },
      ...duplicates,
    );
  }
  expect(subject.score(turns).outcome).toBe('pass');
  for (let index = 0; index < 3; index++) {
    const wrongFirst = structuredClone(turns);
    wrongFirst[index].output.layout.instances.reverse();
    expect(subject.score(wrongFirst).outcome).toBe('fail');
  }
});

test('D36 leaves unprohibited Actions/params, turn-1 plan and snapshot continuity unscored', async () => {
  const { subject, turns } = await evidence();
  turns[0].output.executionPlan.push({
    instanceId: 'labs-main',
    action: 'unverified',
  });
  turns[1].output.executionPlan = [
    { instanceId: 'weather-main', action: 'unverified' },
    { instanceId: 'labs-main', action: 'unverified' },
  ];
  turns[2].output.executionPlan.push({
    instanceId: 'calendar-main',
    action: 'unverified',
  });
  for (const turn of turns) {
    turn.output.executionPlan.push({
      instanceId: 'foreign',
      action: 'conflictingAction',
      params: { ignored: [null, true, { value: 42 }] },
    });
    turn.output.executionPlan[0].params = { malformed: { arguments: [false] } };
    turn.state.layout = { type: 'grid', instances: [] };
    turn.resultingState.layout = { type: 'grid', instances: [] };
  }
  expect(subject.score(turns).outcome).toBe('pass');
  const { data, inputs, expected } = documents();
  for (const params of [
    null,
    false,
    42,
    'ignored',
    ['nested', { data: [1, null] }],
  ]) {
    data.responses[0].executionPlan[0].params = params;
    expect(
      (
        await evaluateSample(
          identity,
          legacyCrossVessel(data, inputs, expected),
        )
      ).evaluation,
    ).toBe('pass');
  }
});

test('D36 validates the original Weather/Calendar fixture and independent distinct Labs identity', async () => {
  const { data, inputs, expected } = documents();
  for (const mutate of [
    (value: typeof data) => {
      value.initial.layout.instances.push(expected.labs);
    },
    (value: typeof data) => {
      value.initial.layout.instances.pop();
    },
    (value: typeof data) => {
      value.initial.layout.instances[0].variant = 'hourly';
    },
    (value: typeof data) => {
      value.initial.layout.instances[1].variant = 'week';
    },
    (value: typeof data) => {
      value.initial.layout.instances[1].instanceId = 'weather-main';
    },
    (value: typeof data) => {
      value.initial.layout.type = 'grid';
    },
  ]) {
    const invalid = structuredClone(data);
    mutate(invalid);
    expect(crossVesselDataSchema.safeParse(invalid).success).toBe(false);
  }
  for (const id of ['weather-main', 'calendar-main']) {
    const reused = { ...expected, labs: { ...expected.labs, instanceId: id } };
    expect(crossVesselExpectationsSchema.safeParse(reused).success).toBe(false);
    expect(() => legacyCrossVessel(data, inputs, reused)).toThrow();
  }
  data.initial.layout.instances[0].instanceId = 'different-weather';
  expect(
    (await evaluateSample(identity, legacyCrossVessel(data, inputs, expected)))
      .evaluation,
  ).toBe('fail');
});

test('D36 rejects malformed/incomplete evidence, extra turns and changed prompts/indices without scoring errors', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [
    null,
    {},
    [],
    turns.slice(0, 2),
    [...turns, turns[2]],
    [...turns].reverse(),
  ])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (let index = 0; index < 3; index++) {
    for (const field of [
      'index',
      'input',
      'state',
      'output',
      'resultingState',
    ]) {
      const invalid = structuredClone(turns);
      delete (invalid[index] as unknown as Record<string, unknown>)[field];
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    for (const field of ['state', 'output', 'resultingState'] as const) {
      for (const layout of [
        null,
        {},
        { type: 'tiling' },
        { type: 'unknown', instances: [] },
      ]) {
        const invalid = structuredClone(turns);
        Object.assign(invalid[index][field], { layout });
        expect(subject.score(invalid).outcome).toBe('fail');
      }
    }
    const missingPlan = structuredClone(turns);
    delete (missingPlan[index].output as Record<string, unknown>).executionPlan;
    expect(subject.score(missingPlan).outcome).toBe('fail');
    const changed = structuredClone(turns);
    changed[index].input.intent = 'other';
    expect(subject.score(changed).outcome).toBe('fail');
    changed[index].input.intent = turns[index].input.intent;
    changed[index] = { ...changed[index], index: (index + 1) % 3 };
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const completeness of ['partial', 'absent'] as const) {
    const result = await evaluateSample(identity, {
      ...subject,
      execute: async () => ({
        completeness,
        disposition: 'planned',
        value: turns,
      }),
      score: () => {
        throw new Error('Must not score incomplete evidence');
      },
    });
    expect(result.evaluation).toBe('unscored');
    expect(result.error).toBeUndefined();
  }
});

test('D36 bounds Action/Instance collections and arbitrary JSON parameters', async () => {
  const { data } = documents();
  const response = data.responses[0];
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const params of [
    { a: { b: { c: { d: {} } } } },
    Array(21).fill(null),
    Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`key${i}`, null])),
    'x'.repeat(1001),
    { ['x'.repeat(121)]: null },
    { '': null },
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    () => null,
    new Date(),
    { undefined },
    cycle,
  ])
    expect(
      crossVesselResponseSchema.safeParse({
        ...response,
        executionPlan: [
          { instanceId: 'weather-main', action: 'showHourly', params },
        ],
      }).success,
    ).toBe(false);
  for (const invalid of [
    { ...response, executionPlan: Array(21).fill(response.executionPlan[0]) },
    {
      ...response,
      layout: {
        type: 'tiling',
        instances: Array(21).fill(response.layout.instances[0]),
      },
    },
    {
      ...response,
      executionPlan: [{ ...response.executionPlan[0], execute: 'code' }],
    },
  ])
    expect(crossVesselResponseSchema.safeParse(invalid).success).toBe(false);
});

test('D36 resets snapshots, supports consistent renaming/order and never synthesizes responses from expectations', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyCrossVessel(data, inputs, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation).toEqual(first.observation);
  expect(first.observation?.[1].output.layout).not.toBe(
    first.observation?.[1].resultingState.layout,
  );
  expect(first.observation?.[1].resultingState).not.toBe(
    first.observation?.[2].state,
  );
  const renamed = structuredClone(expected);
  renamed.labs.instanceId = 'new-labs';
  const changed = await evaluateSample(
    identity,
    legacyCrossVessel(data, inputs, renamed),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(first.observation);
  renamed.weather.instanceId = 'new-weather';
  renamed.calendar.instanceId = 'new-calendar';
  for (const state of [data.initial, ...data.responses]) {
    for (const item of state.layout.instances)
      item.instanceId =
        item.vesselId === 'weather'
          ? 'new-weather'
          : item.vesselId === 'calendar'
            ? 'new-calendar'
            : 'new-labs';
    state.layout.instances.reverse();
  }
  for (const response of data.responses)
    for (const action of response.executionPlan)
      action.instanceId = 'new-weather';
  expect(
    (await evaluateSample(identity, legacyCrossVessel(data, inputs, renamed)))
      .evaluation,
  ).toBe('pass');
});
