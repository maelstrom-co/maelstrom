import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type TargetDisambiguationResponse,
  type TargetDisambiguationState,
  targetDisambiguationDataSchema,
} from '../../packages/evals/src/adapters/legacy-target-disambiguation.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyTargetDisambiguation,
  type TargetDisambiguationTurn,
} from './target-disambiguation-fixture.js';

const identity = {
  runId: 'target-disambiguation-controls',
  caseId: 'target-disambiguation',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in target-disambiguation controls');
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
    (item) => item.definition.id === 'target-disambiguation',
  );
  if (!item || item.definition.profile !== 'legacy-target-disambiguation')
    throw new Error('Missing target-disambiguation case');
  return {
    data: targetDisambiguationDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
function adapter() {
  const { data, inputs, expected } = documents();
  return legacyTargetDisambiguation(data, inputs, expected);
}
async function evidence() {
  const subject = adapter();
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing evidence');
  return { subject, turns: structuredClone([...result.observation]) };
}
async function rescore(change: (turns: TargetDisambiguationTurn[]) => void) {
  const { subject, turns } = await evidence();
  change(turns);
  return evaluateSample(identity, {
    ...subject,
    execute: async () => ({
      completeness: 'complete',
      disposition: 'planned',
      value: turns,
    }),
  });
}
function changeWeather(state: TargetDisambiguationState, variant: string) {
  for (const items of [state.instances, state.layout.instances]) {
    const weather = items.find((item) => item.vesselId === 'weather');
    if (!weather) throw new Error('Missing Weather control');
    weather.variant = variant;
  }
}
const weekly = { instanceId: 'weather-main', action: 'showWeekly' };

test('D24 pins source requests and independent Weather/Calendar expectations', async () => {
  const { inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Change the left panel.',
    'I mean the weather one.',
    'Make it weekly.',
    'Leave calendar exactly as it is.',
  ]);
  expect(expected).toEqual({
    instanceId: 'weather-main',
    action: 'showWeekly',
    variant: 'weekly',
    forbidActionsOn: ['calendar-main'],
    unchangedInstances: [{ instanceId: 'calendar-main', variant: 'month' }],
    forbidNewInstances: true,
  });
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [],
    [],
    [weekly],
    [],
  ]);
  expect(turns.map((turn) => turn.state.instances[0].variant)).toEqual([
    'current',
    'current',
    'current',
    'weekly',
  ]);
  expect(turns.map((turn) => turn.resultingState.instances[0].variant)).toEqual(
    ['current', 'current', 'weekly', 'weekly'],
  );
  expect(
    turns.every((turn) => turn.output.instances[1].variant === 'month'),
  ).toBe(true);
});

test('D24 rejects early Actions and missing/wrong/mistimed decisive Actions', async () => {
  for (const index of [0, 1]) {
    const result = await rescore((turns) => {
      turns[index].output.executionPlan = [weekly];
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toContain(
      `Turn ${index} must not contain premature Actions`,
    );
  }
  for (const plan of [
    [],
    [{ ...weekly, action: 'showHourly' }],
    [{ ...weekly, instanceId: 'calendar-main' }],
    [{ ...weekly, instanceId: 'foreign' }],
  ]) {
    const result = await rescore((turns) => {
      turns[2].output.executionPlan = plan;
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toContain(
      'Turn 2 is missing the decisive weekly Action',
    );
  }
  const delayed = await rescore((turns) => {
    turns[2].output.executionPlan = [];
    turns[3].output.executionPlan = [weekly];
  });
  expect(delayed.evaluation).toBe('fail');
});

test('D24 forbids Calendar and foreign targets on every turn, including simultaneous decisive-turn Actions', async () => {
  for (let index = 0; index < 4; index++) {
    for (const instanceId of ['calendar-main', 'foreign']) {
      const result = await rescore((turns) => {
        turns[index].output.executionPlan.push({
          instanceId,
          action: 'showWeek',
        });
      });
      expect(result.evaluation).toBe('fail');
      expect(result.failures).toContain(
        instanceId === 'calendar-main'
          ? `Turn ${index} contains a forbidden Calendar Action`
          : `Turn ${index} has a foreign Action target`,
      );
      if (index === 2)
        expect(result.observation?.[2].output.executionPlan).toContainEqual(
          weekly,
        );
    }
  }
});

test('D24 checks exact identities, Vessels, membership and Calendar state in all pre/response/retained projections', async () => {
  const { subject, turns } = await evidence();
  const mutations: ((items: TargetDisambiguationState['instances']) => void)[] =
    [
      (items) => {
        items.pop();
      },
      (items) => {
        items.splice(0);
      },
      (items) => {
        items.push({ ...items[0], instanceId: 'extra' });
      },
      (items) => {
        items[1] = { ...items[0] };
      },
      (items) => {
        items[0].instanceId = 'replacement';
      },
      (items) => {
        items[1].instanceId = 'other-calendar';
      },
      (items) => {
        items[0].vesselId = 'calendar';
      },
      (items) => {
        items[1].vesselId = 'weather';
      },
      (items) => {
        items[1].variant = 'week';
      },
    ];
  for (let index = 0; index < 4; index++) {
    for (const field of ['state', 'output', 'resultingState'] as const) {
      for (const layout of [false, true]) {
        for (const mutate of mutations) {
          const changed = structuredClone(turns);
          const state = changed[index][field];
          mutate((layout ? state.layout : state).instances);
          expect(subject.score(changed).outcome).toBe('fail');
        }
      }
      const changed = structuredClone(turns);
      changed[index][field].layout.type = 'grid';
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
});

test('D24 rejects premature Weather change, discontinuity, and final weekly regression', async () => {
  for (let index = 0; index < 4; index++) {
    for (const field of ['state', 'output', 'resultingState'] as const) {
      const result = await rescore((turns) => {
        const current = turns[index][field].instances[0].variant;
        changeWeather(
          turns[index][field],
          current === 'weekly' ? 'current' : 'weekly',
        );
      });
      expect(result.execution).toBe('completed');
      expect(result.evaluation).toBe('fail');
      expect(result.error).toBeUndefined();
    }
  }
  const premature = await rescore((turns) => {
    changeWeather(turns[1].output, 'weekly');
    changeWeather(turns[1].resultingState, 'weekly');
    changeWeather(turns[2].state, 'weekly');
  });
  expect(premature.evaluation).toBe('fail');
  const lostFinal = await rescore((turns) => {
    changeWeather(turns[3].resultingState, 'current');
  });
  expect(lostFinal.failures).toEqual([
    'Turn 3 lost resulting state or tiling membership',
  ]);
});

test('D24 permits late same-Weather-target plans without claiming Action validity or effects', async () => {
  for (const latePlan of [
    [],
    [{ instanceId: 'weather-main', action: 'unverifiedAction' }],
  ]) {
    const { data, inputs, expected } = documents();
    data.responses[3].executionPlan = structuredClone(latePlan);
    data.responses[2].executionPlan.push({
      instanceId: 'weather-main',
      action: 'unverifiedAdditionalAction',
    });
    const result = await evaluateSample(
      identity,
      legacyTargetDisambiguation(data, inputs, expected),
    );
    expect(result.evaluation).toBe('pass');
  }
});

test('D24 fails closed on missing/malformed evidence, turn count, prompt and sequence errors', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [
    null,
    {},
    [],
    turns.slice(0, 3),
    [...turns, turns[3]],
    [...turns].reverse(),
  ])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (let index = 0; index < 4; index++) {
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
      for (const member of ['layout', 'instances']) {
        const invalid = structuredClone(turns);
        delete (invalid[index][field] as Record<string, unknown>)[member];
        expect(subject.score(invalid).outcome).toBe('fail');
      }
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
    const missing = structuredClone(turns);
    delete (missing[index].output as Partial<TargetDisambiguationResponse>)
      .executionPlan;
    expect(subject.score(missing).outcome).toBe('fail');
    const changed = structuredClone(turns);
    changed[index].input.intent = 'other prompt';
    expect(subject.score(changed).outcome).toBe('fail');
    changed[index].input.intent = turns[index].input.intent;
    changed[index] = { ...changed[index], index: (index + 1) % 4 };
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

test('D24 resets samples, copies snapshots and accepts consistent renaming and reordering', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyTargetDisambiguation(data, inputs, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.evaluation).toBe('pass');
  expect(second.observation).toEqual(first.observation);
  if (!first.observation) throw new Error('Missing evidence');
  expect(first.observation[2].output.instances).not.toBe(
    first.observation[2].resultingState.instances,
  );
  expect(first.observation[2].resultingState).not.toBe(
    first.observation[3].state,
  );
  expect(first.observation[2].output.instances).not.toBe(
    first.observation[2].output.layout.instances,
  );
  for (const state of [data.initial, ...data.responses]) {
    for (const items of [state.instances, state.layout.instances]) {
      for (const item of items) item.instanceId = `${item.vesselId}-renamed`;
      items.reverse();
    }
  }
  data.responses[2].executionPlan[0].instanceId = 'weather-renamed';
  expected.instanceId = 'weather-renamed';
  expected.forbidActionsOn[0] = 'calendar-renamed';
  expected.unchangedInstances[0].instanceId = 'calendar-renamed';
  expect(
    (
      await evaluateSample(
        identity,
        legacyTargetDisambiguation(data, inputs, expected),
      )
    ).evaluation,
  ).toBe('pass');
});
