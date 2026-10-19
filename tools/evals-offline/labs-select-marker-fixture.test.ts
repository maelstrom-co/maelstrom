import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type LabsSelectMarkerResponse,
  labsSelectMarkerDataSchema,
} from '../../packages/evals/src/adapters/legacy-labs-select-marker.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  type LabsSelectMarkerTurn,
  legacyLabsSelectMarker,
} from './labs-select-marker-fixture.js';

const identity = {
  runId: 'labs-selection-controls',
  caseId: 'labs-select-marker',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in Labs selection controls');
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
    (item) => item.definition.id === 'labs-select-marker',
  );
  if (!item || item.definition.profile !== 'legacy-labs-select-marker')
    throw new Error('Missing Labs selection case');
  return {
    data: labsSelectMarkerDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
function adapter() {
  const { data, inputs, expected } = documents();
  return legacyLabsSelectMarker(data, inputs, expected);
}
async function evidence() {
  const subject = adapter();
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observations');
  return { subject, turns: structuredClone([...result.observation]) };
}
async function rescore(change: (turns: LabsSelectMarkerTurn[]) => void) {
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
const selection = (markerSlug: string | number | null) => ({
  instanceId: 'labs-main',
  action: 'selectMarker',
  params: { markerSlug },
});

test('D23 pins four source prompts and turn-1 positive selection, distinct from D19 enum safety', async () => {
  const { inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Focus the labs chart on one marker.',
    'Use hemoglobin.',
    'Keep the current trends view.',
    'Do not switch to upload or list.',
  ]);
  expect(expected).toEqual({
    instanceId: 'labs-main',
    action: 'selectMarker',
    markerSlug: 'hemoglobin',
    variant: 'trends',
    forbiddenActions: ['showUpload', 'showList'],
    forbidNewInstances: true,
  });
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [],
    [selection('hemoglobin')],
    [],
    [],
  ]);
  expect(
    loadOfflineCases().find((item) => item.definition.id === 'wrong-enum')
      ?.definition,
  ).toMatchObject({
    profile: 'legacy-response-constraint',
    expectations: { rule: 'marker-enum' },
    lineage: [
      { pointer: '/items/18', taskId: 'cap-maelstrom-edge-wrong-enum' },
    ],
  });
});

test('D23 requires the exact Action, target and string slug on turn 1, not merely the final response', async () => {
  const invalid: LabsSelectMarkerResponse['executionPlan'][] = [
    [],
    [{ ...selection('hemoglobin'), instanceId: 'other' }],
    [{ ...selection('hemoglobin'), action: 'selectMarkers' }],
    [selection('platelets')],
    [selection('glucose')],
    [selection('Hemoglobin')],
    [selection('hemoglobin ')],
    [selection('')],
    [selection(3)],
    [selection(null)],
    [{ instanceId: 'labs-main', action: 'selectMarker' }],
    [{ instanceId: 'labs-main', action: 'selectMarker', params: {} }],
    [{ instanceId: 'labs-main', action: 'selectMarker', params: null }],
  ];
  for (const plan of invalid) {
    const result = await rescore((turns) => {
      turns[1].output.executionPlan = plan;
    });
    expect(result.execution).toBe('completed');
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toEqual([
      'Turn 1 is missing the expected marker selection Action',
    ]);
    expect(result.error).toBeUndefined();
  }
  for (const index of [0, 2, 3]) {
    const result = await rescore((turns) => {
      turns[1].output.executionPlan = [];
      turns[index].output.executionPlan = [selection('hemoglobin')];
    });
    expect(result.evaluation).toBe('fail');
  }
});

test('D23 checks tiling, trends, target and single layout member only on turns 0, 2, 3', async () => {
  const target = {
    instanceId: 'labs-main',
    vesselId: 'labs',
    variant: 'trends',
  };
  for (const index of [0, 2, 3]) {
    for (const layout of [
      { type: 'grid' as const, instances: [target] },
      { type: 'tiling' as const, instances: [] },
      {
        type: 'tiling' as const,
        instances: [{ ...target, instanceId: 'replacement' }],
      },
      { type: 'tiling' as const, instances: [target, target] },
      {
        type: 'tiling' as const,
        instances: [target, { ...target, instanceId: 'extra' }],
      },
      { type: 'tiling' as const, instances: [{ ...target, variant: 'list' }] },
      {
        type: 'tiling' as const,
        instances: [{ ...target, variant: 'upload' }],
      },
    ]) {
      const result = await rescore((turns) => {
        turns[index].output.layout = layout;
      });
      expect(result.evaluation).toBe('fail');
      expect(result.error).toBeUndefined();
    }
    for (const action of ['showUpload', 'showList'])
      for (const instanceId of ['labs-main', 'foreign']) {
        const result = await rescore((turns) => {
          turns[index].output.executionPlan = [
            selection('hemoglobin'),
            { instanceId, action },
          ];
        });
        expect(result.evaluation).toBe('fail');
        expect(result.failures).toEqual([
          `Turn ${index} contains forbidden navigation`,
        ]);
      }
  }
});

test('D23 explicitly does not prove marker persistence, foreign-target safety or all-turn navigation correctness', async () => {
  for (const index of [0, 2, 3]) {
    const changedSelection = await rescore((turns) => {
      turns[index].output.executionPlan = [selection('glucose')];
    });
    expect(changedSelection.evaluation).toBe('pass');
    const foreign = await rescore((turns) => {
      turns[index].output.executionPlan = [
        { instanceId: 'foreign', action: 'unverifiedAction' },
      ];
    });
    expect(foreign.evaluation).toBe('pass');
  }
  const uncheckedDecisiveTurn = await rescore((turns) => {
    turns[1].output.executionPlan = [
      selection('hemoglobin'),
      selection('glucose'),
      { instanceId: 'foreign', action: 'showUpload' },
      { instanceId: 'labs-main', action: 'showList' },
    ];
    turns[1].output.layout = { type: 'grid', instances: [] };
    turns[1].resultingState.layout = { type: 'grid', instances: [] };
    turns[2].state.layout = { type: 'grid', instances: [] };
  });
  expect(uncheckedDecisiveTurn.evaluation).toBe('pass');
  const { data, inputs, expected } = documents();
  data.responses[1].layout = { type: 'grid', instances: [] };
  data.responses[1].executionPlan.push({
    instanceId: 'labs-main',
    action: 'showUpload',
  });
  const scriptedGap = await evaluateSample(
    identity,
    legacyLabsSelectMarker(data, inputs, expected),
  );
  expect(scriptedGap.evaluation).toBe('pass');
  expect(scriptedGap.observation?.[2].state.layout.type).toBe('grid');
});

test('D23 does not silently add Vessel-identity or retained-state/continuity scoring', async () => {
  const result = await rescore((turns) => {
    for (const turn of turns) {
      turn.state.layout = { type: 'grid', instances: [] };
      turn.resultingState.layout = { type: 'grid', instances: [] };
      turn.output.layout.instances[0].vesselId = 'unverified-vessel';
    }
  });
  expect(result.evaluation).toBe('pass');
});

test('D23 fails closed on missing/malformed evidence and changed prompt/index or turn count', async () => {
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
    for (const field of ['layout', 'executionPlan'] as const) {
      const invalid = structuredClone(turns);
      delete (invalid[index].output as Partial<LabsSelectMarkerResponse>)[
        field
      ];
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    for (const layout of [
      null,
      {},
      { type: 'tiling' },
      { type: 'other', instances: [] },
    ]) {
      const invalid = structuredClone(turns);
      Object.assign(invalid[index].output, { layout });
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    const invalid = structuredClone(turns);
    invalid[index].input.intent = 'other';
    expect(subject.score(invalid).outcome).toBe('fail');
    invalid[index].input.intent = turns[index].input.intent;
    invalid[index] = { ...invalid[index], index: (index + 1) % 4 };
    expect(subject.score(invalid).outcome).toBe('fail');
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

test('D23 resets samples, snapshots independently and allows consistent synthetic target renaming', async () => {
  const { data, inputs, expected } = documents();
  const subject = legacyLabsSelectMarker(data, inputs, expected);
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
  for (const state of [data.initial, ...data.responses])
    state.layout.instances[0].instanceId = 'renamed-labs';
  data.responses[1].executionPlan[0].instanceId = 'renamed-labs';
  expected.instanceId = 'renamed-labs';
  expect(
    (
      await evaluateSample(
        identity,
        legacyLabsSelectMarker(data, inputs, expected),
      )
    ).evaluation,
  ).toBe('pass');
});
