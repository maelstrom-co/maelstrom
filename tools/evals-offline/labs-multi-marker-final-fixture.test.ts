import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type LabsMultiMarkerFinalResponse,
  labsMultiMarkerFinalDataSchema,
  labsMultiMarkerFinalExpectationsSchema,
  labsMultiMarkerFinalResponseSchema,
} from '../../packages/evals/src/adapters/legacy-labs-multi-marker-final.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  type LabsMultiMarkerFinalTurn,
  legacyLabsMultiMarkerFinal,
} from './labs-multi-marker-final-fixture.js';

const identity = {
  runId: 'labs-multi-marker-final-controls',
  caseId: 'labs-multi-marker-final',
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
    (item) => item.definition.id === 'labs-multi-marker-final',
  );
  if (!item || item.definition.profile !== 'legacy-labs-multi-marker-final')
    throw new Error('Missing Labs selection case');
  return {
    data: labsMultiMarkerFinalDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
function adapter() {
  const { data, inputs, expected } = documents();
  return legacyLabsMultiMarkerFinal(data, inputs, expected);
}
async function evidence() {
  const subject = adapter();
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observations');
  return { subject, turns: structuredClone([...result.observation]) };
}
async function rescore(change: (turns: LabsMultiMarkerFinalTurn[]) => void) {
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
const slugs: ['hemoglobin', 'platelets', 'glucose'] = [
  'hemoglobin',
  'platelets',
  'glucose',
];
const selection = (markerSlugs: unknown = slugs) => ({
  instanceId: 'labs-main',
  action: 'selectMarkers',
  params: { markerSlugs },
});
function plan(value: unknown): LabsMultiMarkerFinalResponse['executionPlan'] {
  return labsMultiMarkerFinalResponseSchema.shape.executionPlan.parse(value);
}

test('D30/T09 pins exact prompts, lineage and final Action independently of D19 and D23', async () => {
  const { inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Show me my lab trends.',
    'Add hemoglobin and platelets to the chart.',
    'Also include glucose.',
  ]);
  expect(expected).toEqual({
    instanceId: 'labs-main',
    action: 'selectMarkers',
    markerSlugs: slugs,
  });
  const item = loadOfflineCases().find(
    (item) => item.definition.id === 'labs-multi-marker-final',
  );
  expect(item?.definition).toMatchObject({
    synthetic: true,
    migration: 'legacy-derived-harness',
    review: 'pending-human-review',
    lineage: [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        pointer: '/items/29',
        taskId: 'cap-maelstrom-multiturn-labs-multi-markers',
        datasetId: 'cap-maelstrom-multiturn-labs-multi-markers',
      },
    ],
  });
  const { turns } = await evidence();
  expect(turns).toHaveLength(3);
  expect(turns[2].output.executionPlan).toEqual(plan([selection()]));
  expect(
    loadOfflineCases().find((item) => item.definition.id === 'wrong-enum')
      ?.definition.profile,
  ).toBe('legacy-response-constraint');
  expect(
    loadOfflineCases().find(
      (item) => item.definition.id === 'labs-select-marker',
    )?.definition.profile,
  ).toBe('legacy-labs-select-marker');
});

test('D30 accepts all six slug permutations', async () => {
  for (const markerSlugs of [
    ['hemoglobin', 'platelets', 'glucose'],
    ['hemoglobin', 'glucose', 'platelets'],
    ['platelets', 'hemoglobin', 'glucose'],
    ['platelets', 'glucose', 'hemoglobin'],
    ['glucose', 'hemoglobin', 'platelets'],
    ['glucose', 'platelets', 'hemoglobin'],
  ]) {
    const result = await rescore((turns) => {
      turns[2].output.executionPlan = plan([selection(markerSlugs)]);
    });
    expect(result.evaluation).toBe('pass');
  }
});

test('D30 requires the exact final Action, target, parameter and actual unique string array', async () => {
  const invalid = [
    [],
    [{ ...selection(), instanceId: 'other' }],
    [{ ...selection(), action: 'selectMarker' }],
    [{ instanceId: 'labs-main', action: 'selectMarkers' }],
    [{ ...selection(), params: null }],
    [{ ...selection(), params: {} }],
    [{ ...selection(), params: { markerSlug: slugs } }],
    [
      {
        ...selection(),
        params: { unrelated: slugs, note: 'hemoglobin platelets glucose' },
      },
    ],
    [
      {
        ...selection(),
        params: { markerSlugs: ['hemoglobin'], unrelated: slugs },
      },
    ],
    ...[
      [],
      ['hemoglobin', 'platelets'],
      ['hemoglobin', 'glucose'],
      ['platelets', 'glucose'],
      [...slugs, 'unknown'],
      [...slugs, 'hemoglobin'],
      ['hemoglobin', 'hemoglobin', 'glucose'],
      ['hemoglobin', 'platelets', 'unknown'],
      ['Hemoglobin', 'platelets', 'glucose'],
      ['hemoglobin ', 'platelets', 'glucose'],
      [null, 'platelets', 'glucose'],
      [42, 'platelets', 'glucose'],
      [true, 'platelets', 'glucose'],
      [['hemoglobin'], 'platelets', 'glucose'],
      [{ slug: 'hemoglobin' }, 'platelets', 'glucose'],
      'hemoglobin platelets glucose',
      JSON.stringify(slugs),
      { 0: 'hemoglobin', 1: 'platelets', 2: 'glucose', length: 3 },
      null,
    ].map((value) => [selection(value)]),
  ];
  for (const value of invalid) {
    const result = await rescore((turns) => {
      turns[2].output.executionPlan = plan(value);
    });
    expect(result.execution).toBe('completed');
    expect(result.evaluation).toBe('fail');
    expect(result.failures).toEqual([
      'Turn 2 is missing the exact-set marker selection Action',
    ]);
    expect(result.error).toBeUndefined();
  }
});

test('D30 only scores final index 2; earlier correct Actions and the stale F03b sequence fail', async () => {
  for (const index of [0, 1]) {
    const result = await rescore((turns) => {
      turns[2].output.executionPlan = [];
      turns[index].output.executionPlan = plan([selection()]);
    });
    expect(result.evaluation).toBe('fail');
  }
  const stale = await rescore((turns) => {
    turns[0].output.executionPlan = plan([
      selection(['hemoglobin', 'glucose']),
    ]);
    turns[1].output.executionPlan = plan([selection()]);
    turns[2].output.executionPlan = [];
  });
  expect(stale.evaluation).toBe('fail');
});

test('D30 deliberately permits extra params, unrelated Actions and conflicting selections in either order', async () => {
  for (const extra of [
    {
      instanceId: 'foreign',
      action: 'showUpload',
      params: { note: { values: [true, null, 7] } },
    },
    selection(['glucose']),
    selection(['unknown', 'unknown']),
    { instanceId: 'labs-main', action: 'selectMarkers', params: {} },
  ])
    for (const correctFirst of [true, false]) {
      const correct = {
        ...selection(),
        params: { markerSlugs: slugs, extra: { nested: ['ignored'] } },
      };
      const result = await rescore((turns) => {
        turns[2].output.executionPlan = plan(
          correctFirst ? [correct, extra] : [extra, correct],
        );
      });
      expect(result.evaluation).toBe('pass');
    }
});

test('D30 intermediate Actions, all layouts and retained state are semantically unscored', async () => {
  for (const intermediate of [
    [],
    [selection()],
    [selection(['unknown'])],
    [{ instanceId: 'foreign', action: 'showList', params: { ignored: false } }],
  ]) {
    const result = await rescore((turns) => {
      turns[0].output.executionPlan = plan(intermediate);
      turns[1].output.executionPlan = plan(intermediate);
      for (const turn of turns) {
        turn.output.layout = { type: 'grid', instances: [] };
        turn.state.layout = { type: 'tiling', instances: [] };
        turn.resultingState.layout = {
          type: 'grid',
          instances: [
            { instanceId: 'other', vesselId: 'other', variant: 'other' },
          ],
        };
      }
    });
    expect(result.evaluation).toBe('pass');
  }
});

test('D30 malformed evidence fails closed and partial/absent evidence remains unscored', async () => {
  const { subject, turns } = await evidence();
  for (const value of [
    null,
    {},
    [],
    turns.slice(0, 2),
    [...turns, turns[2]],
    [...turns].reverse(),
  ])
    expect(subject.score(value as typeof turns).outcome).toBe('fail');
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
    for (const output of [
      null,
      {},
      { executionPlan: [] },
      { layout: { type: 'grid', instances: [] } },
      { ...turns[index].output, executionPlan: [{}] },
      {
        ...turns[index].output,
        executionPlan: [{ ...selection(), params: { markerSlugs: undefined } }],
      },
      { ...turns[index].output, unexpected: slugs },
    ]) {
      const invalid = structuredClone(turns);
      Object.assign(invalid[index], { output });
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    const invalid = structuredClone(turns);
    invalid[index].input.intent = 'changed';
    expect(subject.score(invalid).outcome).toBe('fail');
    invalid[index].input.intent = turns[index].input.intent;
    invalid[index] = { ...invalid[index], index: (index + 1) % 3 };
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

test('D30 response schema bounds Actions, params, JSON nesting and string sizes', () => {
  const { data } = documents();
  const response = data.responses[2];
  for (const executionPlan of [
    Array.from({ length: 21 }, () => selection()),
    [
      {
        ...selection(),
        params: Object.fromEntries(
          Array.from({ length: 21 }, (_, index) => [`key${index}`, null]),
        ),
      },
    ],
    [selection(Array(21).fill('hemoglobin'))],
    [{ ...selection(), params: { extra: { a: { b: { c: { d: null } } } } } }],
    [{ ...selection(), params: { extra: 'x'.repeat(1001) } }],
    [{ ...selection(), params: { extra: Number.POSITIVE_INFINITY } }],
  ])
    expect(
      labsMultiMarkerFinalResponseSchema.safeParse({
        ...response,
        executionPlan,
      }).success,
    ).toBe(false);
});

test('D30 expectation changes cannot manufacture observations or weaken the exact-set contract', async () => {
  const { data, inputs, expected } = documents();
  data.responses[2].executionPlan = plan([selection(['glucose'])]);
  const original = await evaluateSample(
    identity,
    legacyLabsMultiMarkerFinal(data, inputs, expected),
  );
  expect(original.evaluation).toBe('fail');
  const reordered = {
    ...expected,
    markerSlugs: [...expected.markerSlugs].reverse(),
  };
  const changed = await evaluateSample(
    identity,
    legacyLabsMultiMarkerFinal(data, inputs, reordered),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(original.observation);
  for (const change of [
    { instanceId: 'other' },
    { action: 'selectMarker' },
    { markerSlugs: ['glucose'] },
    { markerSlugs: [...slugs, 'unknown'] },
    { markerSlugs: ['hemoglobin', 'hemoglobin', 'glucose'] },
    { markerSlugs: ['hemoglobin', 'platelets', 'unknown'] },
    { turnIndex: 1 },
  ])
    expect(
      labsMultiMarkerFinalExpectationsSchema.safeParse({
        ...expected,
        ...change,
      }).success,
    ).toBe(false);
  const subject = adapter();
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation).toEqual(first.observation);
  expect(second.evaluation).toBe('pass');
});
