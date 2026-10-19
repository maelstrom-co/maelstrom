import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type LabsStateResetSyntheticData,
  labsStateResetSyntheticDataSchema,
  labsStateResetSyntheticExpectationsSchema,
  labsStateResetSyntheticInputsSchema,
} from '../../packages/evals/src/adapters/labs-state-reset-synthetic.js';
import { validateLoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import {
  labsStateResetSynthetic,
  scoreLabsStateResetSynthetic,
} from './labs-state-reset-synthetic-fixture.js';

const identity = {
  runId: 'd33-synthetic-controls',
  caseId: 'labs-state-reset-synthetic',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D33 synthetic controls');
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
    (entry) => entry.definition.id === identity.caseId,
  );
  if (!item || item.definition.profile !== 'labs-state-reset-synthetic')
    throw new Error('Missing D33 synthetic extension');
  return {
    item,
    data: labsStateResetSyntheticDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = labsStateResetSynthetic(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing synthetic observations');
  return { subject, turns: structuredClone([...result.observation]) };
}

test('D33 synthetic third prompt is separate, COMPLETE and explicitly not a dataset prompt or runtime proof', async () => {
  const { item, inputs, expected } = documents();
  const original = loadOfflineCases().find(
    (entry) => entry.definition.id === 'labs-state-reset-subset',
  );
  if (
    !original ||
    original.definition.profile !== 'legacy-labs-state-reset-subset'
  )
    throw new Error('Missing original D33 subset');
  expect(item.definition).toMatchObject({
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    lineage: original.definition.lineage,
  });
  expect(item.definition.lineage).toEqual([
    {
      source: 'legacy',
      revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
      path: 'langfuse/maelstrom-eval-dataset.v1.json',
      taskId: 'cap-maelstrom-multiturn-state-reset',
      datasetId: 'cap-maelstrom-multiturn-state-reset',
      pointer: '/items/32',
    },
  ]);
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Show me the list of my lab results.',
    'Go back to the trends chart.',
    "What's the trend for hemoglobin?",
  ]);
  expect(original.definition.inputs.turns).toEqual([
    inputs.turns[0],
    inputs.turns[1],
  ]);
  expect(original.definition.title).toContain('COMPLETE D33');
  expect(item.definition.purpose).toContain(
    'synthetic and absent from the dataset',
  );
  expect(item.definition.purpose).toContain('No LLM semantics');
  expect(item.definition.purpose).toContain(
    'current-app/runtime compatibility',
  );
  expect(expected.coverage).toBe('COMPLETE');
  expect(expected).not.toHaveProperty('requiredUnresolved');
  const result = await evaluateSample(identity, caseAdapter(item));
  expect(result.evaluation).toBe('pass');
  expect(result.provenance).toContain('third prompt absent from dataset');
  expect(result.provenance).toContain(
    'optional first-match enum safety is a separate case',
  );
  expect(
    result.records.filter((record) => record.kind === 'turn'),
  ).toHaveLength(3);
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.state.layout.instances[0].variant)).toEqual([
    'trends',
    'list',
    'trends',
  ]);
  expect(
    turns.map((turn) => turn.resultingState.layout.instances[0].variant),
  ).toEqual(['list', 'trends', 'trends']);
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [{ instanceId: 'labs-main', action: 'showList' }],
    [{ instanceId: 'labs-main', action: 'showTrends' }],
    [
      {
        instanceId: 'labs-main',
        action: 'selectMarker',
        params: { markerSlug: 'hemoglobin' },
      },
    ],
  ]);
});

test('synthetic reset requires exactly one intended Action on each turn', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const error of ['missing', 'extra', 'duplicate', 'target', 'action']) {
      const changed = structuredClone(turns);
      const plan = changed[index].output.executionPlan;
      if (error === 'missing') plan.length = 0;
      if (error === 'extra')
        plan.push({ instanceId: 'other', action: 'unrelated' });
      if (error === 'duplicate') plan.push(structuredClone(plan[0]));
      if (error === 'target') plan[0].instanceId = 'other';
      if (error === 'action') plan[0].action = 'showUpload';
      expect(subject.score(changed).outcome).toBe('fail');
    }
    const changed = structuredClone(turns);
    changed[index].output.executionPlan[0].params = { unexpected: 'value' };
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('synthetic third-turn marker is required and exact, not optional enum safety', async () => {
  const { subject, turns } = await evidence();
  const invalidParams: Array<
    LabsStateResetSyntheticData['responses'][number]['executionPlan'][number]['params']
  > = [
    undefined,
    null,
    'hemoglobin',
    {},
    { markerSlug: null },
    { markerSlug: 'platelets' },
    { markerSlug: 'glucose' },
    { markerSlug: 'invalid' },
    { markerSlug: ['hemoglobin'] },
    { markerSlug: 'hemoglobin', extra: true },
  ];
  for (const params of invalidParams) {
    const changed = structuredClone(turns);
    changed[2].output.executionPlan[0].params = params;
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const index of [0, 1]) {
    const changed = structuredClone(turns);
    changed[index].output.executionPlan[0].params = {
      markerSlug: 'hemoglobin',
    };
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('synthetic reset scores exact layout membership, identity, Variants and snapshot continuity', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const field of ['state', 'output', 'resultingState'] as const) {
      for (const error of [
        'grid',
        'missing',
        'extra',
        'target',
        'vessel',
        'variant',
      ]) {
        const changed = structuredClone(turns);
        const layout = changed[index][field].layout;
        if (error === 'grid') layout.type = 'grid';
        if (error === 'missing') layout.instances = [];
        if (error === 'extra')
          layout.instances.push(structuredClone(layout.instances[0]));
        if (error === 'target') layout.instances[0].instanceId = 'other';
        if (error === 'vessel') layout.instances[0].vesselId = 'other';
        if (error === 'variant') layout.instances[0].variant = 'upload';
        expect(subject.score(changed).outcome).toBe('fail');
      }
    }
  }
});

test('synthetic reset fails closed on missing, malformed or reordered evidence and contracts', async () => {
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
      const changed = structuredClone(turns);
      delete (changed[index] as unknown as Record<string, unknown>)[field];
      expect(subject.score(changed).outcome).toBe('fail');
    }
    for (const change of [
      { index: (index + 1) % 3 },
      { input: { intent: 'Changed prompt' } },
    ]) {
      const changed = structuredClone(turns);
      Object.assign(changed[index], change);
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
  const { inputs, expected } = documents();
  expect(
    scoreLabsStateResetSynthetic(
      turns,
      null as unknown as typeof inputs,
      expected,
    ).outcome,
  ).toBe('fail');
  expect(
    scoreLabsStateResetSynthetic(turns, inputs, {} as typeof expected).outcome,
  ).toBe('fail');
});

test('synthetic profile rejects changed prompts, oracle constraints, lineage and incompatible fixture kinds', () => {
  const { item, inputs, expected } = documents();
  for (const turns of [
    inputs.turns.slice(0, 2),
    [...inputs.turns, inputs.turns[2]],
    [...inputs.turns].reverse(),
  ])
    expect(
      labsStateResetSyntheticInputsSchema.safeParse({ turns }).success,
    ).toBe(false);
  for (const expectations of [
    { ...expected, markerSlug: 'platelets' },
    { ...expected, instanceId: 'other' },
    { ...expected, actions: ['showList', 'showTrends'] },
    { ...expected, requiredUnresolved: [] },
    { ...expected, coverage: 'complete' },
    { ...expected, judge: true },
  ])
    expect(
      labsStateResetSyntheticExpectationsSchema.safeParse(expectations).success,
    ).toBe(false);
  for (const definition of [
    { ...item.definition, lineage: [] },
    {
      ...item.definition,
      lineage: [
        {
          source: 'current',
          revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
          path: 'src/case.ts',
          scenarioId: 'variant',
        },
      ],
    },
    { ...item.definition, profile: 'legacy-labs-state-reset-subset' },
    { ...item.definition, review: 'approved' },
    {
      ...item.definition,
      oracle: { id: 'legacy-labs-state-reset-subset', version: 1 },
    },
  ])
    expect(() =>
      validateLoadedCase({ ...item, definition } as typeof item),
    ).toThrow();
  expect(() =>
    validateLoadedCase({
      ...item,
      fixture: { ...item.fixture, kind: 'labs-state-reset-subset-script' },
    }),
  ).toThrow();
});

test('synthetic data stays bounded and cannot claim selected-marker state', () => {
  const { data } = documents();
  for (const change of [
    (value: typeof data) => {
      value.responses.pop();
    },
    (value: typeof data) => {
      value.responses.push(value.responses[2]);
    },
    (value: typeof data) => {
      value.initial.layout.instances[0].variant = 'list';
    },
    (value: typeof data) => {
      value.responses[2].executionPlan = Array(21).fill(
        value.responses[2].executionPlan[0],
      );
    },
    (value: typeof data) => {
      value.responses[2].layout.instances = Array(21).fill(
        value.initial.layout.instances[0],
      );
    },
    (value: typeof data) => {
      value.responses[2].executionPlan[0].params = {
        markerSlug: 'x'.repeat(1001),
      };
    },
    (value: typeof data) => {
      Object.assign(value.responses[2].layout, {
        selectedMarker: 'hemoglobin',
      });
    },
  ]) {
    const invalid = structuredClone(data);
    change(invalid);
    expect(labsStateResetSyntheticDataSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

test('synthetic script drives evidence independently of expectations and each sample starts fresh', async () => {
  const { data, inputs, expected } = documents();
  data.responses[2].executionPlan[0].params = { markerSlug: 'platelets' };
  const subject = labsStateResetSynthetic(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('fail');
  expect(result.observation?.[2].output.executionPlan[0].params).toEqual({
    markerSlug: 'platelets',
  });
  expect(expected.markerSlug).toBe('hemoglobin');
  expect(result.observation?.[0].state.layout.instances[0].variant).toBe(
    'trends',
  );
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation).toEqual(result.observation);
  expect(second.evaluation).toBe('fail');
});
