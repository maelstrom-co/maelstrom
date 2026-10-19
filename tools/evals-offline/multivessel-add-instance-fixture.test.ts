import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  multivesselAddDataSchema,
  multivesselAddExpectationsSchema,
  multivesselAddInputsSchema,
  multivesselAddResponseSchema,
} from '../../packages/evals/src/adapters/legacy-multivessel-add-instance.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import { legacyMultivesselAddInstance } from './multivessel-add-instance-fixture.js';

const identity = {
  runId: 'multivessel-add-controls',
  caseId: 'multivessel-add-instance',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in multivessel addition controls');
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
    (item) => item.definition.id === 'multivessel-add-instance',
  );
  if (!item || item.definition.profile !== 'legacy-multivessel-add-instance')
    throw new Error('Missing D34 case');
  return {
    item,
    data: multivesselAddDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = legacyMultivesselAddInstance(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing evidence');
  return { subject, turns: structuredClone([...result.observation]) };
}

test('D34 pins two supplied requests, fresh synthetic Calendar and original Weather context', async () => {
  const { data, inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'I want to see my calendar alongside the weather.',
    'Show the monthly view.',
  ]);
  expect(expected).toEqual({
    retainedInstance: {
      instanceId: 'weather-main',
      vesselId: 'weather',
      variant: 'current',
    },
    addedInstance: {
      instanceId: 'calendar-added',
      vesselId: 'calendar',
      finalVariant: 'month',
    },
  });
  expect(data.registeredVessels).toEqual(['weather', 'labs', 'calendar']);
  expect(data.initial.layout.instances).toEqual([expected.retainedInstance]);
  const { turns } = await evidence();
  expect(turns).toHaveLength(2);
  expect(turns[0].output.executionPlan).toEqual([
    { instanceId: 'calendar-added', action: 'showWeekly' },
  ]);
  expect(turns[0].output.layout.instances[1]).toMatchObject({
    instanceId: 'calendar-added',
    vesselId: 'calendar',
  });
  expect(turns[1].output.layout.instances[1]).toEqual({
    instanceId: 'calendar-added',
    vesselId: 'calendar',
    variant: 'month',
  });
});

test('D34 requires the fresh Calendar target in the first response plan, not a later or foreign step', async () => {
  const { subject, turns } = await evidence();
  for (const plan of [
    [],
    [{ instanceId: 'weather-main', action: 'showWeekly' }],
    [{ instanceId: 'other-calendar', action: 'showWeekly' }],
    [{ instanceId: 'foreign', action: 'createCalendar' }],
  ]) {
    const changed = structuredClone(turns);
    changed[0].output.executionPlan = plan;
    changed[1].output.executionPlan = [
      { instanceId: 'calendar-added', action: 'anything' },
    ];
    expect(subject.score(changed).failures).toContain(
      'Turn 0 is missing an Action targeting the added Calendar',
    );
  }
  for (const index of [0, 1]) {
    for (const mutation of [
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances.pop();
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[1].instanceId = 'replacement-calendar';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[1].instanceId = 'weather-main';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[1].vesselId = 'labs';
      },
    ]) {
      const changed = structuredClone(turns);
      mutation(changed[index]);
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
});

test('D34 strengthens Weather ID presence into original Weather/current preservation on both responses', async () => {
  const { subject, turns } = await evidence();
  for (const index of [0, 1]) {
    for (const mutation of [
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances.shift();
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[0].instanceId = 'other-weather';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[0].vesselId = 'calendar';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[0].variant = 'weekly';
      },
    ]) {
      const changed = structuredClone(turns);
      mutation(changed[index]);
      expect(subject.score(changed).failures).toContain(
        `Turn ${index} did not preserve original Weather/current`,
      );
    }
  }
});

test('D34 requires tiling responses and final Calendar/month but not a turn-0 Calendar Variant', async () => {
  const { subject, turns } = await evidence();
  for (const index of [0, 1]) {
    const changed = structuredClone(turns);
    changed[index].output.layout.type = 'grid';
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const variant of ['week', 'unverified-variant']) {
    const changed = structuredClone(turns);
    changed[0].output.layout.instances[1].variant = variant;
    expect(subject.score(changed).outcome).toBe('pass');
    changed[1].output.layout.instances[1].variant = variant;
    expect(subject.score(changed).failures).toContain(
      'Turn 1 Calendar must be month',
    );
  }
});

test('D34 permits extras and duplicate IDs with source first-match semantics, not exact membership', async () => {
  const { subject, turns } = await evidence();
  for (const turn of turns) {
    turn.output.layout.instances.reverse();
    turn.output.layout.instances.push(
      { instanceId: 'extra-labs', vesselId: 'labs', variant: 'trends' },
      { instanceId: 'other-calendar', vesselId: 'calendar', variant: 'week' },
      { instanceId: 'weather-main', vesselId: 'other', variant: 'wrong' },
      { instanceId: 'calendar-added', vesselId: 'other', variant: 'wrong' },
    );
  }
  expect(subject.score(turns).outcome).toBe('pass');
  for (const index of [0, 1]) {
    const changed = structuredClone(turns);
    changed[index].output.layout.instances.reverse();
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('D34 Action names/params and entire turn-1 plan are unscored, even if unrelated or conflicting', async () => {
  const { data, inputs, expected } = documents();
  for (const params of [
    null,
    false,
    42,
    'not-action-arguments',
    ['array', { nested: [null, true] }],
    { markerSlugs: ['unknown'], arbitrary: { nested: [{ value: 'ignored' }] } },
  ]) {
    data.responses[0].executionPlan =
      multivesselAddResponseSchema.shape.executionPlan.parse([
        { instanceId: 'foreign', action: 'unverified', params },
        {
          instanceId: 'calendar-added',
          action: 'notARegisteredAction',
          params,
        },
        { instanceId: 'calendar-added', action: 'conflictingAction', params },
      ]);
    for (const plan of [
      [],
      [{ instanceId: 'foreign', action: 'removeEverything', params }],
    ]) {
      data.responses[1].executionPlan =
        multivesselAddResponseSchema.shape.executionPlan.parse(plan);
      const result = await evaluateSample(
        identity,
        legacyMultivesselAddInstance(data, inputs, expected),
      );
      expect(result.evaluation).toBe('pass');
    }
  }
});

test('D34 pre-/retained-state snapshots are structural evidence only, not execution-order proof', async () => {
  const { subject, turns } = await evidence();
  for (const turn of turns) {
    turn.state.layout = { type: 'grid', instances: [] };
    turn.resultingState.layout = {
      type: 'tiling',
      instances: [{ instanceId: 'other', vesselId: 'other', variant: 'other' }],
    };
  }
  expect(subject.score(turns).outcome).toBe('pass');
});

test('D34 validates initial context and rejects reused Calendar identity independently from scripts', async () => {
  const { data, inputs, expected } = documents();
  const reused = {
    ...expected,
    addedInstance: { ...expected.addedInstance, instanceId: 'weather-main' },
  };
  expect(multivesselAddExpectationsSchema.safeParse(reused).success).toBe(
    false,
  );
  expect(() => legacyMultivesselAddInstance(data, inputs, reused)).toThrow();
  for (const mutation of [
    (value: typeof data) => {
      value.initial.layout.instances[0].variant = 'weekly';
    },
    (value: typeof data) => {
      value.initial.layout.instances[0].vesselId = 'calendar';
    },
    (value: typeof data) => {
      value.initial.layout.instances.push({
        instanceId: 'calendar-added',
        vesselId: 'calendar',
        variant: 'month',
      });
    },
    (value: typeof data) => {
      value.initial.layout.instances = [];
    },
    (value: typeof data) => {
      value.initial.layout.type = 'grid';
    },
  ]) {
    const invalid = structuredClone(data);
    mutation(invalid);
    expect(multivesselAddDataSchema.safeParse(invalid).success).toBe(false);
  }
  const different = structuredClone(data);
  different.initial.layout.instances[0].instanceId = 'other-weather';
  expect(
    (
      await evaluateSample(
        identity,
        legacyMultivesselAddInstance(different, inputs, expected),
      )
    ).evaluation,
  ).toBe('fail');
});

test('D34 fails closed on incomplete/extra turns, changed order/requests, malformed and unbounded evidence', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [
    null,
    {},
    [],
    turns.slice(0, 1),
    [...turns, turns[1]],
    [...turns].reverse(),
  ])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (const index of [0, 1]) {
    for (const field of [
      'index',
      'input',
      'state',
      'output',
      'resultingState',
    ]) {
      const changed = structuredClone(turns);
      delete (changed[index] as unknown as Record<string, unknown>)[field];
      expect(subject.score(changed).outcome).toBe('fail');
    }
    for (const output of [
      null,
      {},
      { executionPlan: [] },
      { layout: { type: 'tiling' } },
      { ...turns[index].output, executionPlan: [{}] },
    ]) {
      const changed = structuredClone(turns);
      Object.assign(changed[index], { output });
      expect(subject.score(changed).outcome).toBe('fail');
    }
    const changed = structuredClone(turns);
    changed[index].input.intent = 'different request';
    expect(subject.score(changed).outcome).toBe('fail');
    changed[index].input.intent = turns[index].input.intent;
    changed[index] = { ...changed[index], index: 1 - index };
    expect(subject.score(changed).outcome).toBe('fail');
  }
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const params of [
    { a: { b: { c: { d: {} } } } },
    Array(21).fill(null),
    Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`key${i}`, null])),
    'x'.repeat(1001),
    { ['x'.repeat(121)]: null },
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    () => null,
    new Date(),
    { missing: undefined },
    cycle,
  ]) {
    const changed = structuredClone(turns);
    Object.assign(changed[0].output.executionPlan[0], { params });
    expect(subject.score(changed).outcome).toBe('fail');
  }
  const { data, inputs } = documents();
  expect(
    multivesselAddInputsSchema.safeParse({
      turns: [...inputs.turns, inputs.turns[0]],
    }).success,
  ).toBe(false);
  for (const output of [
    {
      ...data.responses[0],
      executionPlan: Array(21).fill(data.responses[0].executionPlan[0]),
    },
    {
      ...data.responses[0],
      layout: {
        type: 'tiling',
        instances: Array(21).fill(data.initial.layout.instances[0]),
      },
    },
    {
      ...data.responses[0],
      executionPlan: [
        { instanceId: 'calendar-added', action: 'arbitrary', unexpected: true },
      ],
    },
  ])
    expect(multivesselAddResponseSchema.safeParse(output).success).toBe(false);
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

test('D34 resets independent snapshots, permits consistent renaming and never generates responses from expectations', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyMultivesselAddInstance(data, inputs, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation).toEqual(first.observation);
  expect(first.observation?.[0].output.layout).not.toBe(
    first.observation?.[0].resultingState.layout,
  );
  expect(first.observation?.[0].resultingState).not.toBe(
    first.observation?.[1].state,
  );
  const renamed = structuredClone(expected);
  renamed.addedInstance.instanceId = 'another-calendar';
  const changed = await evaluateSample(
    identity,
    legacyMultivesselAddInstance(data, inputs, renamed),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(first.observation);
  data.initial.layout.instances[0].instanceId = 'another-weather';
  renamed.retainedInstance.instanceId = 'another-weather';
  for (const response of data.responses) {
    response.layout.instances[0].instanceId = 'another-weather';
    response.layout.instances[1].instanceId = 'another-calendar';
    response.layout.instances.reverse();
    for (const action of response.executionPlan)
      action.instanceId = 'another-calendar';
  }
  expect(
    (
      await evaluateSample(
        identity,
        legacyMultivesselAddInstance(data, inputs, renamed),
      )
    ).evaluation,
  ).toBe('pass');
});
