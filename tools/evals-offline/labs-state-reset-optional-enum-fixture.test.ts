import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type LabsOptionalEnumResponse,
  labsOptionalEnumDataSchema,
  labsOptionalEnumExpectationsSchema,
  labsOptionalEnumInputsSchema,
} from '../../packages/evals/src/adapters/labs-state-reset-optional-enum.js';
import { validateLoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import {
  labsStateResetOptionalEnum,
  scoreLabsOptionalEnum,
} from './labs-state-reset-optional-enum-fixture.js';

const identity = {
  runId: 'd33-optional-enum-controls',
  caseId: 'labs-state-reset-optional-enum',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D33 optional enum controls');
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
  if (!item || item.definition.profile !== 'labs-state-reset-optional-enum')
    throw new Error('Missing D33 optional enum slice');
  return {
    item,
    data: labsOptionalEnumDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = labsStateResetOptionalEnum(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing optional enum observation');
  return { subject, turns: structuredClone([...result.observation]) };
}
function marker(markerSlug: string) {
  return {
    instanceId: 'labs-main',
    action: 'selectMarker',
    params: { markerSlug },
  };
}

test('D33 optional enum slice reuses the existing synthetic third prompt and remains isolated/COMPLETE', async () => {
  const { item, inputs, expected } = documents();
  const synthetic = loadOfflineCases().find(
    (entry) => entry.definition.id === 'labs-state-reset-synthetic',
  );
  if (
    !synthetic ||
    synthetic.definition.profile !== 'labs-state-reset-synthetic'
  )
    throw new Error('Missing original synthetic positive-emission case');
  expect(inputs.intent).toBe(synthetic.definition.inputs.turns[2].intent);
  expect(inputs.intent).toBe("What's the trend for hemoglobin?");
  expect(item.definition).toMatchObject({
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    lineage: synthetic.definition.lineage,
  });
  expect(item.definition.lineage[0]).toMatchObject({
    source: 'legacy',
    revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
    path: 'langfuse/maelstrom-eval-dataset.v1.json',
    taskId: 'cap-maelstrom-multiturn-state-reset',
    datasetId: 'cap-maelstrom-multiturn-state-reset',
    pointer: '/items/32',
  });
  expect(item.definition.title).toContain('COMPLETE');
  expect(item.definition.purpose).toContain('not a three-turn reset');
  expect(expected.coverage).toBe('COMPLETE');
  expect(expected).not.toHaveProperty('requiredUnresolved');
  expect(synthetic.definition.expectations).not.toHaveProperty(
    'requiredUnresolved',
  );
  const result = await evaluateSample(identity, caseAdapter(item));
  expect(result.evaluation).toBe('pass');
  expect(result.provenance).toContain(
    'isolated optional first-match enum predicate',
  );
  expect(result.provenance).toContain('not a reset session');
  expect(
    result.records.filter((record) => record.kind === 'turn'),
  ).toHaveLength(1);
});

test('D33 absence passes and every allowed first marker passes without requiring hemoglobin', async () => {
  const { subject, turns } = await evidence();
  expect(turns[0].output.executionPlan).toEqual([]);
  for (const slug of ['hemoglobin', 'platelets', 'glucose']) {
    const changed = structuredClone(turns);
    changed[0].output.executionPlan = [marker(slug)];
    expect(subject.score(changed).outcome).toBe('pass');
  }
});

test('D33 first matching marker requires an exact allowed string, not missing or coercible params', async () => {
  const { subject, turns } = await evidence();
  const invalid: Array<
    LabsOptionalEnumResponse['executionPlan'][number]['params']
  > = [
    undefined,
    null,
    true,
    1,
    'hemoglobin',
    [],
    {},
    { markerSlug: null },
    { markerSlug: 1 },
    { markerSlug: true },
    { markerSlug: ['hemoglobin'] },
    { markerSlug: {} },
    { markerSlug: '' },
    { markerSlug: 'invalid' },
    { markerSlug: 'Hemoglobin' },
    { markerSlug: ' hemoglobin ' },
  ];
  for (const params of invalid) {
    const changed = structuredClone(turns);
    changed[0].output.executionPlan = [{ ...marker('hemoglobin'), params }];
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('D33 only the first labs-main/selectMarker is scored, unlike D19 every-match safety', async () => {
  const { subject, turns } = await evidence();
  for (const plan of [
    [{ ...marker('invalid'), instanceId: 'other' }],
    [{ ...marker('invalid'), action: 'selectMarkers' }],
    [marker('hemoglobin'), marker('invalid')],
    [marker('platelets'), marker('glucose')],
    [{ ...marker('invalid'), instanceId: 'other' }, marker('glucose')],
    [{ ...marker('invalid'), action: 'selectMarkers' }, marker('platelets')],
    [{ ...marker('glucose'), params: { markerSlug: 'glucose', extra: true } }],
  ]) {
    const changed = structuredClone(turns);
    changed[0].output.executionPlan = plan;
    expect(subject.score(changed).outcome).toBe('pass');
  }
  for (const plan of [
    [marker('invalid'), marker('hemoglobin')],
    [{ ...marker('hemoglobin'), params: {} }, marker('hemoglobin')],
    [{ ...marker('hemoglobin'), instanceId: 'other' }, marker('invalid')],
  ]) {
    const changed = structuredClone(turns);
    changed[0].output.executionPlan = plan;
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('D33 enum evidence fails closed on missing, malformed, extra or misidentified observations', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [null, {}, [], [...turns, turns[0]]])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (const field of ['index', 'input', 'state', 'output', 'resultingState']) {
    const changed = structuredClone(turns);
    delete (changed[0] as unknown as Record<string, unknown>)[field];
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const change of [
    { index: 2 },
    { input: { intent: 'Changed prompt' } },
    { output: {} },
    { output: { executionPlan: null } },
    { output: { executionPlan: [], layout: {} } },
    { state: { selectedMarker: 'hemoglobin' } },
  ]) {
    const changed = structuredClone(turns);
    Object.assign(changed[0], change);
    expect(subject.score(changed).outcome).toBe('fail');
  }
  const { inputs, expected } = documents();
  expect(
    scoreLabsOptionalEnum(turns, {} as typeof inputs, expected).outcome,
  ).toBe('fail');
  expect(
    scoreLabsOptionalEnum(turns, inputs, {} as typeof expected).outcome,
  ).toBe('fail');
});

test('D33 enum profile rejects widened contracts, substituted lineage and incompatible fixture data', () => {
  const { item, inputs, expected } = documents();
  expect(
    labsOptionalEnumInputsSchema.safeParse({ ...inputs, sourceTurn: 2 })
      .success,
  ).toBe(false);
  for (const expectations of [
    { ...expected, instanceId: 'other' },
    { ...expected, action: 'selectMarkers' },
    { ...expected, allowedMarkerSlugs: ['hemoglobin', 'invalid', 'glucose'] },
    { ...expected, requiredUnresolved: [] },
    { ...expected, coverage: 'complete' },
    { ...expected, judge: true },
  ])
    expect(
      labsOptionalEnumExpectationsSchema.safeParse(expectations).success,
    ).toBe(false);
  for (const definition of [
    { ...item.definition, lineage: [] },
    {
      ...item.definition,
      lineage: [{ ...item.definition.lineage[0], pointer: '/items/18' }],
    },
    { ...item.definition, profile: 'labs-state-reset-synthetic' },
    {
      ...item.definition,
      oracle: { id: 'legacy-response-constraint', version: 1 },
    },
    { ...item.definition, review: 'approved' },
  ])
    expect(() =>
      validateLoadedCase({ ...item, definition } as typeof item),
    ).toThrow();
  for (const data of [
    {},
    { response: {} },
    {
      response: {
        executionPlan: Array.from({ length: 21 }, () => marker('glucose')),
      },
    },
    {
      response: {
        executionPlan: [
          { ...marker('glucose'), params: { markerSlug: 'x'.repeat(1001) } },
        ],
      },
    },
    {
      response: {
        executionPlan: [
          { ...marker('glucose'), params: { nested: [[[[['too deep']]]]] } },
        ],
      },
    },
  ])
    expect(labsOptionalEnumDataSchema.safeParse(data).success).toBe(false);
  expect(() =>
    validateLoadedCase({
      ...item,
      fixture: { ...item.fixture, kind: 'labs-state-reset-synthetic-script' },
    }),
  ).toThrow();
});

test('D33 independent candidate and fresh samples never manufacture selections from expectations', async () => {
  const { data, inputs, expected } = documents();
  data.response.executionPlan = [marker('invalid')];
  const subject = labsStateResetOptionalEnum(data, inputs, expected);
  data.response.executionPlan = [marker('hemoglobin')];
  const first = await evaluateSample(identity, subject);
  expect(first.evaluation).toBe('fail');
  if (!first.observation) throw new Error('Missing independent enum evidence');
  expect(first.observation[0].output.executionPlan).toEqual([
    marker('invalid'),
  ]);
  first.observation[0].output.executionPlan = [marker('hemoglobin')];
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.evaluation).toBe('fail');
  expect(second.observation?.[0].output.executionPlan).toEqual([
    marker('invalid'),
  ]);
});
