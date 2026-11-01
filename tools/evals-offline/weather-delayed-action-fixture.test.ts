import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type WeatherDelayedActionResponse,
  type WeatherDelayedActionState,
  weatherDelayedActionDataSchema,
} from '../../packages/evals/src/adapters/legacy-weather-delayed-action.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyWeatherDelayedAction,
  type WeatherDelayedActionTurn,
} from './weather-delayed-action-fixture.js';

const identity = {
  runId: 'weather-delayed-action-controls',
  caseId: 'weather-delayed-action',
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
    (item) => item.definition.id === 'weather-delayed-action',
  );
  if (!item || item.definition.profile !== 'legacy-weather-delayed-action')
    throw new Error('Missing delayed-action case');
  return {
    data: weatherDelayedActionDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
function adapter() {
  const { data, inputs, expected } = documents();
  return legacyWeatherDelayedAction(data, inputs, expected);
}
function changeVariant(state: WeatherDelayedActionState, variant: string) {
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
async function rescore(change: (turns: WeatherDelayedActionTurn[]) => void) {
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

test('D32 retains exactly three source prompts, current no-ops, then final weekly state', async () => {
  const { inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'I need to check some weather data.',
    'What is the forecast looking like?',
    'Show me the weekly view.',
  ]);
  expect(expected).toEqual({
    instanceId: 'weather-main',
    action: 'showWeekly',
    variant: 'weekly',
    forbidNewInstances: true,
  });
  const { turns } = await evidence();
  expect(turns).toHaveLength(3);
  expect(turns.map((turn) => turn.state.instances[0].variant)).toEqual([
    'current',
    'current',
    'current',
  ]);
  expect(turns.map((turn) => turn.resultingState.instances[0].variant)).toEqual(
    ['current', 'current', 'weekly'],
  );
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [],
    [],
    [{ instanceId: 'weather-main', action: 'showWeekly' }],
  ]);
});

test('D32 rejects early Actions and layout-only premature weekly mutation with an empty plan', async () => {
  for (const index of [0, 1]) {
    const action = await rescore((turns) => {
      turns[index].output.executionPlan = [
        { instanceId: 'weather-main', action: 'showWeekly' },
      ];
    });
    expect(action.evaluation).toBe('fail');
    for (const field of ['output', 'resultingState'] as const) {
      const layout = await rescore((turns) => {
        turns[index][field].layout.instances[0].variant = 'weekly';
      });
      expect(layout.evaluation).toBe('fail');
    }
  }
});

test('D32 rejects already-weekly no-op and unrelated final Actions despite weekly layout', async () => {
  for (const executionPlan of [
    [],
    [{ instanceId: 'weather-main', action: 'showHourly' }],
    [
      { instanceId: 'weather-main', action: 'unrelated' },
      { instanceId: 'weather-main', action: 'showCurrent' },
    ],
  ]) {
    const result = await rescore((turns) => {
      turns[2].output.executionPlan = executionPlan;
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toContain(
      'Turn 2 is missing the decisive weekly Action',
    );
  }
  const alreadyWeekly = await rescore((turns) => {
    for (const turn of turns) {
      for (const field of ['state', 'output', 'resultingState'] as const)
        changeVariant(turn[field], 'weekly');
      turn.output.executionPlan = [];
    }
  });
  expect(alreadyWeekly.evaluation).toBe('fail');
  const { data, inputs, expected } = documents();
  changeVariant(data.initial, 'weekly');
  expect(() => legacyWeatherDelayedAction(data, inputs, expected)).toThrow();
});

test('D32 checks all three Action targets, including additional foreign steps on the decisive turn', async () => {
  for (let index = 0; index < 3; index++) {
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
    turns[2].output.executionPlan[0].instanceId = 'foreign';
  });
  expect(missing.failures).toContain(
    'Turn 2 is missing the decisive weekly Action',
  );
});

test('D32 requires exact original identity/Vessel/membership in every pre-state, response, layout and retained state', async () => {
  const { subject, turns } = await evidence();
  const changes: ((
    state: WeatherDelayedActionState,
    layout: boolean,
  ) => void)[] = [
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
  for (let index = 0; index < 3; index++) {
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

test('D32 rejects state discontinuity and weekly regression, including the last retained state', async () => {
  for (let index = 0; index < 3; index++) {
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
});

test('D32 rejects missing/malformed evidence, changed prompt/index, reordered or incomplete turns without scoring errors', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [null, {}, [], turns.slice(0, 2), [...turns, turns[2]]])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (let index = 0; index < 3; index++) {
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
        delete (invalid[index][field] as Partial<WeatherDelayedActionState>)[
          member
        ];
        expect(subject.score(invalid).outcome).toBe('fail');
      }
    }
    const invalid = structuredClone(turns);
    delete (invalid[index].output as Partial<WeatherDelayedActionResponse>)
      .executionPlan;
    expect(subject.score(invalid).outcome).toBe('fail');
    const changed = structuredClone(turns);
    changed[index].input.intent = 'different request';
    expect(subject.score(changed).outcome).toBe('fail');
    changed[index].input.intent = turns[index].input.intent;
    changed[index] = { ...changed[index], index: (index + 1) % 3 };
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

test('D32 resets each sample, snapshots independently and permits consistent synthetic target renaming', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyWeatherDelayedAction(data, inputs, expected);
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
    (
      await evaluateSample(
        identity,
        legacyWeatherDelayedAction(data, inputs, expected),
      )
    ).evaluation,
  ).toBe('pass');
});
