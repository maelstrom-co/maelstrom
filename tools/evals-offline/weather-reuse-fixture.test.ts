import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type WeatherReuseResponse,
  type WeatherReuseState,
  weatherReuseDataSchema,
} from '../../packages/evals/src/adapters/legacy-weather-reuse.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyWeatherReuse,
  type WeatherReuseTurn,
} from './weather-reuse-fixture.js';

const identity = {
  runId: 'weather-reuse-controls',
  caseId: 'weather-reuse-weekly',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in weather reuse controls');
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
    (item) => item.definition.id === 'weather-reuse-weekly',
  );
  if (!item || item.definition.profile !== 'legacy-weather-reuse')
    throw new Error('Missing reuse case');
  return {
    data: weatherReuseDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
function adapter() {
  const { data, inputs, expected } = documents();
  return legacyWeatherReuse(data, inputs, expected);
}
function changeVariant(state: WeatherReuseState, variant: string) {
  state.instances[0].variant = variant;
  state.layout.instances[0].variant = variant;
}
async function evidence() {
  const subject = adapter();
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observations');
  return { subject, turns: structuredClone([...result.observation]) };
}
async function rescore(change: (turns: WeatherReuseTurn[]) => void) {
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

test('D22 preserves exact source requests and identity separately from D31 weather-chain', async () => {
  const { inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'I want more detail in the weather panel.',
    'Use the longer-range forecast.',
    'Reuse the existing panel.',
    'Do not create another weather widget.',
  ]);
  expect(expected).toEqual({
    instanceId: 'weather-main',
    action: 'showWeekly',
    variant: 'weekly',
    forbidNewInstances: true,
  });
  const cases = loadOfflineCases();
  expect(
    cases.find((item) => item.definition.id === 'weather-chain')?.definition,
  ).toMatchObject({
    profile: 'weather-session',
    inputs: { turns: ['hourly', 'weekly', 'current'] },
    lineage: [
      {
        pointer: '/items/30',
        taskId: 'cap-maelstrom-multiturn-weather-variant-chain',
      },
    ],
  });
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.state.instances[0].variant)).toEqual([
    'current',
    'hourly',
    'weekly',
    'weekly',
  ]);
  expect(turns.map((turn) => turn.resultingState.instances[0].variant)).toEqual(
    ['hourly', 'weekly', 'weekly', 'weekly'],
  );
});

test('D22 allows both bounded turn-0 alternatives and late empty or nonempty same-target plans', async () => {
  for (const first of ['current', 'hourly']) {
    for (const latePlan of [
      [],
      [{ instanceId: 'weather-main', action: 'unverifiedLateAction' }],
    ]) {
      const { data, inputs, expected } = documents();
      changeVariant(data.responses[0], first);
      data.responses[0].executionPlan =
        first === 'current'
          ? []
          : [{ instanceId: 'weather-main', action: 'showHourly' }];
      data.responses[2].executionPlan = structuredClone(latePlan);
      data.responses[3].executionPlan = structuredClone(latePlan);
      const result = await evaluateSample(
        identity,
        legacyWeatherReuse(data, inputs, expected),
      );
      expect(result.evaluation).toBe('pass');
      expect(result.observation?.[1].state.instances[0].variant).toBe(first);
    }
  }
});

test('D22 rejects premature weekly, inconsistent turn-0 Actions and a missing/wrong decisive transition', async () => {
  const mutations: ((turns: WeatherReuseTurn[]) => void)[] = [
    (turns) => {
      turns[0].output.executionPlan = [
        { instanceId: 'weather-main', action: 'showWeekly' },
      ];
      changeVariant(turns[0].output, 'weekly');
      changeVariant(turns[0].resultingState, 'weekly');
      changeVariant(turns[1].state, 'weekly');
    },
    (turns) => {
      turns[0].output.executionPlan = [];
    },
    (turns) => {
      turns[0].output.executionPlan.push({
        ...turns[0].output.executionPlan[0],
      });
    },
    (turns) => {
      turns[0].output.executionPlan[0].action = 'invented';
    },
    (turns) => {
      turns[1].output.executionPlan = [];
    },
    (turns) => {
      turns[1].output.executionPlan[0].action = 'showHourly';
    },
    (turns) => {
      changeVariant(turns[1].output, 'current');
      changeVariant(turns[1].resultingState, 'current');
      changeVariant(turns[2].state, 'current');
    },
    (turns) => {
      turns[1].output.executionPlan = [];
      turns[2].output.executionPlan = [
        { instanceId: 'weather-main', action: 'showWeekly' },
      ];
    },
  ];
  for (const mutate of mutations) {
    const result = await rescore(mutate);
    expect(result.execution).toBe('completed');
    expect(result.evaluation).toBe('fail');
    expect(result.error).toBeUndefined();
  }
});

test('D22 checks all four Action targets, including additional foreign steps on the decisive turn', async () => {
  for (let index = 0; index < 4; index++) {
    const result = await rescore((turns) => {
      turns[index].output.executionPlan.push({
        instanceId: 'foreign',
        action: 'showWeekly',
      });
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toContain(
      `Turn ${index} has a foreign Action target`,
    );
  }
  const missing = await rescore((turns) => {
    turns[1].output.executionPlan[0].instanceId = 'foreign';
  });
  expect(missing.failures).toContain(
    'Turn 1 is missing the decisive weekly Action',
  );
});

test('D22 requires exact original identity/Vessel/membership in every pre-state, response, layout and retained state', async () => {
  const { subject, turns } = await evidence();
  const changes: ((state: WeatherReuseState, layout: boolean) => void)[] = [
    (state, layout) => {
      (layout ? state.layout : state).instances = [];
    },
    (state, layout) => {
      const items = (layout ? state.layout : state).instances;
      items.push({ ...items[0] });
    },
    (state, layout) => {
      const items = (layout ? state.layout : state).instances;
      items.push({ ...items[0], instanceId: 'extra' });
    },
    (state, layout) => {
      (layout ? state.layout : state).instances[0].instanceId = 'replacement';
    },
    (state, layout) => {
      (layout ? state.layout : state).instances[0].vesselId = 'calendar';
    },
    (state, layout) => {
      (layout ? state.layout : state).instances[0].variant = 'incorrect';
    },
  ];
  for (let index = 0; index < 4; index++) {
    for (const field of ['state', 'output', 'resultingState'] as const) {
      for (const layout of [false, true]) {
        for (const change of changes) {
          const mutated = structuredClone(turns);
          change(mutated[index][field], layout);
          expect(subject.score(mutated).outcome).toBe('fail');
        }
      }
      const nonTiling = structuredClone(turns);
      nonTiling[index][field].layout.type = 'grid';
      expect(subject.score(nonTiling).outcome).toBe('fail');
    }
  }
});

test('D22 rejects state discontinuity and weekly regression, including the last retained state', async () => {
  for (let index = 0; index < 4; index++) {
    for (const field of ['state', 'output', 'resultingState'] as const) {
      const result = await rescore((turns) => {
        const variant =
          turns[index][field].instances[0].variant === 'current'
            ? 'weekly'
            : 'current';
        changeVariant(turns[index][field], variant);
      });
      expect(result.evaluation).toBe('fail');
    }
  }
  const consistentButWrong = await rescore((turns) => {
    changeVariant(turns[2].output, 'current');
    changeVariant(turns[2].resultingState, 'current');
    changeVariant(turns[3].state, 'current');
    changeVariant(turns[3].output, 'current');
    changeVariant(turns[3].resultingState, 'current');
  });
  expect(consistentButWrong.evaluation).toBe('fail');
});

test('D22 rejects missing/malformed evidence, changed prompt/index, reordered or incomplete turns without scoring errors', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [null, {}, [], turns.slice(0, 3), [...turns, turns[3]]])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (let index = 0; index < 4; index++) {
    for (const field of [
      'index',
      'input',
      'state',
      'output',
      'resultingState',
    ] as const) {
      const invalid = structuredClone(turns);
      delete (invalid[index] as unknown as Record<string, unknown>)[field];
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    for (const field of ['state', 'output', 'resultingState'] as const) {
      for (const member of ['instances', 'layout'] as const) {
        const invalid = structuredClone(turns);
        delete (invalid[index][field] as Partial<WeatherReuseState>)[member];
        expect(subject.score(invalid).outcome).toBe('fail');
      }
    }
    const invalid = structuredClone(turns);
    delete (invalid[index].output as Partial<WeatherReuseResponse>)
      .executionPlan;
    expect(subject.score(invalid).outcome).toBe('fail');
    const changed = structuredClone(turns);
    changed[index].input.intent = 'different request';
    expect(subject.score(changed).outcome).toBe('fail');
    changed[index].input.intent = turns[index].input.intent;
    changed[index] = { ...changed[index], index: (index + 1) % 4 };
    expect(subject.score(changed).outcome).toBe('fail');
  }
  expect(subject.score([...turns].reverse()).outcome).toBe('fail');
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

test('D22 resets each sample, snapshots independently and permits consistent synthetic target renaming', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyWeatherReuse(data, inputs, expected);
  const first = await evaluateSample(identity, subject);
  if (!first.observation) throw new Error('Missing observations');
  expect(first.observation[0].output.instances).not.toBe(
    first.observation[0].resultingState.instances,
  );
  expect(first.observation[0].resultingState).not.toBe(
    first.observation[1].state,
  );
  expect(first.observation[0].output.layout.instances).not.toBe(
    first.observation[0].output.instances,
  );
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.evaluation).toBe('pass');
  expect(second.observation).toEqual(first.observation);
  for (const state of [data.initial, ...data.responses]) {
    state.instances[0].instanceId = 'renamed-weather';
    state.layout.instances[0].instanceId = 'renamed-weather';
  }
  for (const response of data.responses)
    for (const action of response.executionPlan)
      action.instanceId = 'renamed-weather';
  expected.instanceId = 'renamed-weather';
  expect(
    (await evaluateSample(identity, legacyWeatherReuse(data, inputs, expected)))
      .evaluation,
  ).toBe('pass');
});
