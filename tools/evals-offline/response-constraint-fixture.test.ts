import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type ConstraintResponse,
  constraintDataSchema,
  constraintResponseSchema,
} from '../../packages/evals/src/adapters/legacy-response-constraint.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyResponseConstraint,
  type ResponseConstraintTurn,
} from './response-constraint-fixture.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in response-constraint controls');
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
const identity = {
  runId: 'response-controls',
  caseId: 'case',
  runtimeId: 'scripted',
  sample: 1,
};
function adapter(id: string) {
  const item = loadOfflineCases().find((item) => item.definition.id === id);
  if (!item || item.definition.profile !== 'legacy-response-constraint')
    throw new Error('Missing constraint case');
  return legacyResponseConstraint(
    constraintDataSchema.parse(item.fixture.data),
    item.definition.inputs,
    item.definition.expectations,
  );
}
const marker = (value: string | number | null) => ({
  instanceId: 'labs-main',
  action: 'selectMarker',
  params: { markerSlug: value },
});

async function rescore(
  id: string,
  change: (turn: ResponseConstraintTurn) => void,
) {
  const subject = adapter(id);
  const positive = await evaluateSample(identity, subject);
  expect(positive.evaluation).toBe('pass');
  if (!positive.observation) throw new Error('Missing control evidence');
  const turns = structuredClone(positive.observation);
  change(turns[0]);
  return evaluateSample(identity, {
    ...subject,
    execute: async () => ({
      completeness: 'complete',
      disposition: 'planned',
      value: turns,
    }),
  });
}

async function responseVerdict(
  id: string,
  executionPlan: ConstraintResponse['executionPlan'],
) {
  return rescore(id, (turn) => {
    turn.output.executionPlan = executionPlan;
  });
}

test('D19 is enum safety: no selection, every allowed slug, and unrelated Actions do not imply positive selection', async () => {
  expect((await responseVerdict('wrong-enum', [])).evaluation).toBe('pass');
  for (const slug of ['hemoglobin', 'platelets', 'glucose'])
    expect(
      (await responseVerdict('wrong-enum', [marker(slug)])).evaluation,
    ).toBe('pass');
  expect(
    (
      await responseVerdict('wrong-enum', [
        marker('hemoglobin'),
        marker('platelets'),
        marker('glucose'),
      ])
    ).evaluation,
  ).toBe('pass');
  expect(
    (
      await responseVerdict('wrong-enum', [
        { instanceId: 'labs-main', action: 'showList' },
      ])
    ).evaluation,
  ).toBe('pass');
});

test('D19 checks every selectMarker, including valid-first/invalid-second and missing/non-string parameters', async () => {
  const invalid: ConstraintResponse['executionPlan'][number][] = [
    marker('cholesterol'),
    marker(''),
    marker(3),
    marker(null),
    { instanceId: 'labs-main', action: 'selectMarker' },
    { instanceId: 'labs-main', action: 'selectMarker', params: null },
    { instanceId: 'labs-main', action: 'selectMarker', params: {} },
  ];
  for (const bad of invalid) {
    for (const plan of [
      [bad],
      [marker('hemoglobin'), bad],
      [bad, marker('glucose')],
    ]) {
      const result = await responseVerdict('wrong-enum', plan);
      expect(result.execution).toBe('completed');
      expect(result.evaluation).toBe('fail');
      expect(
        result.failures.some((reason) => reason.includes('invalid markerSlug')),
      ).toBe(true);
    }
  }
  expect(
    (
      await responseVerdict('wrong-enum', [
        marker('hemoglobin'),
        marker('cholesterol'),
      ])
    ).failures,
  ).toEqual(['Action 1 has an invalid markerSlug']);
});

test('D18 checks source-Variant availability but does not claim Action execution', async () => {
  for (const action of ['showHourly', 'showWeekly'])
    expect(
      (
        await responseVerdict('invalid-action', [
          { instanceId: 'weather-main', action },
        ])
      ).evaluation,
    ).toBe('pass');
  for (const executionPlan of [
    [{ instanceId: 'weather-main', action: 'showCurrent' }],
    [{ instanceId: 'other-instance', action: 'showHourly' }],
    [{ instanceId: 'weather-main', action: 'zoom' }],
    [
      { instanceId: 'weather-main', action: 'showHourly' },
      { instanceId: 'weather-main', action: 'zoom' },
    ],
  ]) {
    const result = await responseVerdict('invalid-action', executionPlan);
    expect(result.evaluation).toBe('fail');
    expect(
      result.failures.some((reason) => reason.includes('unavailable')),
    ).toBe(true);
  }
  expect(
    (
      await responseVerdict('noop-preservation', [
        { instanceId: 'weather-main', action: 'showHourly' },
      ])
    ).evaluation,
  ).toBe('fail');
});

test('D18 and D21 require a tiling layout with the exact unchanged target independently of top-level and retained state', async () => {
  const initial = {
    instanceId: 'weather-main',
    vesselId: 'weather',
    variant: 'current',
  };
  const invalid: ConstraintResponse['layout'][] = [
    undefined,
    { type: 'grid', instances: [initial] },
    { type: 'tiling', instances: [] },
    { type: 'tiling', instances: [{ ...initial, instanceId: 'replacement' }] },
    { type: 'tiling', instances: [initial, initial] },
    { type: 'tiling', instances: [{ ...initial, variant: 'hourly' }] },
    { type: 'tiling', instances: [{ ...initial, vesselId: 'labs' }] },
    {
      type: 'tiling',
      instances: [initial, { ...initial, instanceId: 'extra' }],
    },
  ];
  for (const id of ['invalid-action', 'out-of-scope-no-mutation'])
    for (const layout of invalid) {
      const result = await rescore(id, (turn) => {
        if (layout === undefined) delete turn.output.layout;
        else turn.output.layout = structuredClone(layout);
      });
      expect(result.execution).toBe('completed');
      expect(result.evaluation).toBe('fail');
      expect(result.failures.some((reason) => reason.includes('layout'))).toBe(
        true,
      );
      expect(result.observation?.[0].output.instances).toEqual([initial]);
      expect(result.observation?.[0].resultingState.instances).toEqual([
        initial,
      ]);
    }
});

test('D18, D20 and D21 detect dropped, duplicated, renamed and mutated response or retained Instances and empty reply', async () => {
  const mutations: ((turn: ResponseConstraintTurn) => void)[] = [
    (turn) => {
      turn.output.instances[0].variant = 'hourly';
    },
    (turn) => {
      turn.resultingState.instances[0].variant = 'hourly';
    },
    (turn) => {
      turn.output.instances = [];
    },
    (turn) => {
      turn.resultingState.instances = [];
    },
    (turn) => {
      turn.output.instances.push({ ...turn.output.instances[0] });
    },
    (turn) => {
      turn.resultingState.instances[0].instanceId = 'other';
    },
    (turn) => {
      turn.output.instances[0].vesselId = 'labs';
    },
    (turn) => {
      turn.output.assistantText = '   ';
    },
  ];
  for (const id of [
    'invalid-action',
    'noop-preservation',
    'out-of-scope-no-mutation',
  ])
    for (const mutate of mutations) {
      const result = await rescore(id, mutate);
      expect(result.execution).toBe('completed');
      expect(result.evaluation).toBe('fail');
      expect(result.failures.length).toBeGreaterThan(0);
    }
});

test('response constraints require complete evidence, reset per sample and preserve independent snapshots', async () => {
  for (const id of [
    'invalid-action',
    'wrong-enum',
    'noop-preservation',
    'out-of-scope-no-mutation',
  ]) {
    const subject = adapter(id);
    const first = await evaluateSample(identity, subject);
    expect(first.evaluation).toBe('pass');
    const second = await evaluateSample({ ...identity, sample: 2 }, subject);
    expect(second.observation).toEqual(first.observation);
    expect(subject.score([]).outcome).toBe('fail');
    if (!first.observation) throw new Error('Missing response evidence');
    const malformed = structuredClone(first.observation);
    delete (malformed[0].output as Partial<ConstraintResponse>).executionPlan;
    expect(subject.score(malformed).outcome).toBe('fail');
    for (const completeness of ['partial', 'absent'] as const) {
      const result = await evaluateSample(identity, {
        ...subject,
        execute: async () => ({
          completeness,
          disposition: 'planned',
          value: first.observation ?? [],
        }),
        score: () => {
          throw new Error('Must not score missing evidence');
        },
      });
      expect(result.evaluation).toBe('unscored');
      expect(result.error).toBeUndefined();
    }
  }
});

test('state-preservation constraints accept reordered/renamed Instances but detect changes to non-target state', async () => {
  const item = loadOfflineCases().find(
    (item) => item.definition.id === 'noop-preservation',
  );
  if (!item || item.definition.profile !== 'legacy-response-constraint')
    throw new Error('Missing no-op');
  const data = constraintDataSchema.parse(item.fixture.data);
  data.instances[0].instanceId = 'renamed';
  data.instances.push({ ...data.instances[0], instanceId: 'other-instance' });
  const input = structuredClone(item.definition.inputs);
  input.response.instances = [...data.instances].reverse();
  const subject = legacyResponseConstraint(
    data,
    input,
    item.definition.expectations,
  );
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing state');
  const turns = structuredClone(result.observation);
  turns[0].resultingState.instances[0].variant = 'weekly';
  expect(subject.score(turns).outcome).toBe('fail');
});

test('layout projection is strict and bounded while remaining optional for D19/D20 rules', async () => {
  const subject = adapter('invalid-action');
  const positive = await evaluateSample(identity, subject);
  const response = positive.observation?.[0].output;
  if (!response) throw new Error('Missing synthetic response');
  for (const layout of [
    null,
    {},
    { type: 'tiling' },
    { type: 'other', instances: [] },
    { type: 'tiling', instances: [{ instanceId: 'weather-main' }] },
    { type: 'tiling', instances: Array(21).fill(response.instances[0]) },
    { type: 'tiling', instances: response.instances, command: 'execute' },
  ])
    expect(
      constraintResponseSchema.safeParse({ ...response, layout }).success,
    ).toBe(false);
  for (const id of ['wrong-enum', 'noop-preservation']) {
    const absent = await rescore(id, (turn) => {
      delete turn.output.layout;
    });
    expect(absent.evaluation).toBe('pass');
    const nonTiling = await rescore(id, (turn) => {
      turn.output.layout = { type: 'grid', instances: [] };
    });
    expect(nonTiling.evaluation).toBe('pass');
  }
});

test('D18 layout exact-set check allows reordering and consistent renaming but preserves every represented Instance', async () => {
  const item = loadOfflineCases().find(
    (item) => item.definition.id === 'invalid-action',
  );
  if (!item || item.definition.profile !== 'legacy-response-constraint')
    throw new Error('Missing D18');
  const data = constraintDataSchema.parse(item.fixture.data);
  data.instances[0].instanceId = 'renamed-weather';
  data.instances.push({
    ...data.instances[0],
    instanceId: 'unrelated-weather',
  });
  const input = structuredClone(item.definition.inputs);
  input.response.instances = structuredClone(data.instances);
  input.response.layout = {
    type: 'tiling',
    instances: structuredClone(data.instances).reverse(),
  };
  const subject = legacyResponseConstraint(
    data,
    input,
    item.definition.expectations,
  );
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  const turns = structuredClone(result.observation);
  if (!turns?.[0].output.layout) throw new Error('Missing layout evidence');
  turns[0].output.layout.instances[0].variant = 'weekly';
  const verdict = subject.score(turns);
  expect(verdict.outcome).toBe('fail');
  expect(verdict.failures).toEqual([
    'Tiling layout changed initial Instance state',
  ]);
});

test('D21 accepts arbitrary non-refusal text but rejects every Action and blank text', async () => {
  for (const assistantText of [
    'The weather is 72 degrees.',
    'I like trains.',
  ]) {
    const result = await rescore('out-of-scope-no-mutation', (turn) => {
      turn.output.assistantText = assistantText;
    });
    expect(result.evaluation).toBe('pass');
  }
  for (const action of ['showHourly', 'bookFlight']) {
    const result = await responseVerdict('out-of-scope-no-mutation', [
      { instanceId: 'weather-main', action },
    ]);
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toEqual([
      'No-op response must not contain Actions',
    ]);
  }
  for (const assistantText of ['', ' \t\n ']) {
    const result = await rescore('out-of-scope-no-mutation', (turn) => {
      turn.output.assistantText = assistantText;
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toEqual(['Assistant text is empty']);
  }
});

test('D21 malformed or missing response evidence cannot pass through empty defaults', async () => {
  for (const field of [
    'assistantText',
    'executionPlan',
    'instances',
  ] as const) {
    const result = await rescore('out-of-scope-no-mutation', (turn) => {
      delete (turn.output as Partial<ConstraintResponse>)[field];
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toContain('Missing or malformed response evidence');
  }
  for (const layout of [
    null,
    {},
    { type: 'tiling' },
    { instances: [] },
    { type: 'tiling', instances: null },
    { type: 'unknown', instances: [] },
    { type: 'tiling', instances: [{ instanceId: 'weather-main' }] },
  ]) {
    const result = await rescore('out-of-scope-no-mutation', (turn) => {
      Object.assign(turn.output, { layout });
    });
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toContain('Missing or malformed response evidence');
    expect(result.observation?.[0].output.instances).toEqual(
      result.observation?.[0].state.instances,
    );
    expect(result.observation?.[0].resultingState).toEqual(
      result.observation?.[0].state,
    );
  }
});

test('D21 exact identity, Vessel and Variant checks apply independently to response and retained state', async () => {
  const initial = {
    instanceId: 'weather-main',
    vesselId: 'weather',
    variant: 'current',
  };
  for (const field of ['output', 'resultingState'] as const)
    for (const instances of [
      [],
      [{ ...initial, instanceId: 'replacement' }],
      [initial, { ...initial, instanceId: 'extra' }],
      [initial, initial],
      [{ ...initial, vesselId: 'labs' }],
      [{ ...initial, variant: 'weekly' }],
    ]) {
      const result = await rescore('out-of-scope-no-mutation', (turn) => {
        turn[field].instances = structuredClone(instances);
      });
      expect(result.evaluation).toBe('fail');
      expect(result.failures).toEqual([
        `${field === 'output' ? 'Response' : 'Retained state'} changed initial Instance state`,
      ]);
      expect(result.observation?.[0].output.layout).toEqual({
        type: 'tiling',
        instances: [initial],
      });
    }
});
