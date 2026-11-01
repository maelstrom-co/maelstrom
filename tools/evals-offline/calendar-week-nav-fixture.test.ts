import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { calendarWeekNavDataSchema } from '../../packages/evals/src/adapters/legacy-calendar-week-nav.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type CalendarWeekNavTurn,
  legacyCalendarWeekNav,
} from './calendar-week-nav-fixture.js';
import { loadOfflineCases } from './cases.js';

const identity = {
  runId: 'calendar-week-nav-controls',
  caseId: 'calendar-week-nav',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in Calendar round-trip controls');
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
    (item) => item.definition.id === 'calendar-week-nav',
  );
  if (!item || item.definition.profile !== 'legacy-calendar-week-nav')
    throw new Error('Missing Calendar round-trip case');
  return {
    data: calendarWeekNavDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = legacyCalendarWeekNav(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observations');
  return { subject, turns: structuredClone([...result.observation]) };
}

test('D29 retains exactly three source prompts and week/week/month responses with task-local Actions', async () => {
  const { inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Show me the weekly schedule.',
    'What is on my calendar this week?',
    'Go back to the monthly view.',
  ]);
  expect(expected).toEqual({
    instanceId: 'calendar-main',
    weeklyAction: 'showWeekly',
    monthlyAction: 'showMonthly',
    weeklyVariant: 'week',
    monthlyVariant: 'month',
  });
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.output.layout.instances[0].variant)).toEqual([
    'week',
    'week',
    'month',
  ]);
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [{ instanceId: 'calendar-main', action: 'showWeekly' }],
    [],
    [{ instanceId: 'calendar-main', action: 'showMonthly' }],
  ]);
});

test('D29 rejects missing, wrong, mistimed and dataset-spelled Actions, and any middle-turn Action', async () => {
  const { subject, turns } = await evidence();
  for (const index of [0, 2]) {
    for (const plan of [
      [],
      [
        {
          instanceId: 'foreign',
          action: index === 0 ? 'showWeekly' : 'showMonthly',
        },
      ],
      [{ instanceId: 'calendar-main', action: 'unrelated' }],
      [
        {
          instanceId: 'calendar-main',
          action: index === 0 ? 'showMonthly' : 'showWeekly',
        },
      ],
      [{ instanceId: 'calendar-main', action: 'showMonth' }],
    ]) {
      const changed = structuredClone(turns);
      changed[index].output.executionPlan = plan;
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
  for (const action of ['showWeekly', 'showMonthly', 'unrelated']) {
    const changed = structuredClone(turns);
    changed[1].output.executionPlan.push({
      instanceId: 'calendar-main',
      action,
    });
    expect(subject.score(changed).outcome).toBe('fail');
  }
  const swapped = structuredClone(turns);
  [swapped[0].output.executionPlan, swapped[2].output.executionPlan] = [
    swapped[2].output.executionPlan,
    swapped[0].output.executionPlan,
  ];
  expect(subject.score(swapped).outcome).toBe('fail');
});

test('D29 requires the target Variant in tiling layout on every response', async () => {
  const { subject, turns } = await evidence();
  const mutations: ((turn: CalendarWeekNavTurn) => void)[] = [
    (turn) => {
      turn.output.layout.type = 'grid';
    },
    (turn) => {
      turn.output.layout.instances = [];
    },
    (turn) => {
      turn.output.layout.instances[0].instanceId = 'replacement';
    },
    (turn) => {
      turn.output.layout.instances[0].variant = 'incorrect';
    },
  ];
  for (let index = 0; index < 3; index++)
    for (const mutate of mutations) {
      const changed = structuredClone(turns);
      mutate(changed[index]);
      expect(subject.score(changed).outcome).toBe('fail');
    }
});

test('D29 source-scoring boundaries permit extra Actions/members and do not score Vessel identity or retained-state continuity', async () => {
  const { subject, turns } = await evidence();
  for (const index of [0, 2]) {
    turns[index].output.executionPlan.push(
      { ...turns[index].output.executionPlan[0] },
      { instanceId: 'foreign', action: 'unrelated' },
    );
  }
  for (const turn of turns) {
    turn.output.layout.instances.push(
      { ...turn.output.layout.instances[0] },
      { instanceId: 'extra', vesselId: 'weather', variant: 'current' },
    );
    turn.output.layout.instances[0].vesselId = 'other';
    turn.state.layout = { type: 'grid', instances: [] };
    turn.resultingState.layout = {
      type: 'grid',
      instances: [
        { instanceId: 'different', vesselId: 'other', variant: 'different' },
      ],
    };
  }
  expect(subject.score(turns).outcome).toBe('pass');
});

test('D29 fails closed for malformed/incomplete evidence and changed order, prompt or index', async () => {
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
    for (const field of ['layout', 'executionPlan']) {
      const invalid = structuredClone(turns);
      delete (invalid[index].output as unknown as Record<string, unknown>)[
        field
      ];
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    const changed = structuredClone(turns);
    changed[index].input.intent = 'changed';
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

test('D29 resets samples and expectation changes cannot manufacture response evidence', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyCalendarWeekNav(data, inputs, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.evaluation).toBe('pass');
  expect(second.observation).toEqual(first.observation);
  if (!first.observation) throw new Error('Missing observations');
  expect(first.observation[0].output.layout).not.toBe(
    first.observation[0].resultingState.layout,
  );
  expect(first.observation[0].resultingState).not.toBe(
    first.observation[1].state,
  );
  expected.instanceId = 'different-target';
  const changed = await evaluateSample(
    identity,
    legacyCalendarWeekNav(data, inputs, expected),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(first.observation);
});
