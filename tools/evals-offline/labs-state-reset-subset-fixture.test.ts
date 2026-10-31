import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  labsStateResetSubsetDataSchema,
  labsStateResetSubsetExpectationsSchema,
  labsStateResetSubsetInputsSchema,
  labsStateResetSubsetResponseSchema,
} from '../../packages/evals/src/adapters/legacy-labs-state-reset-subset.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import { legacyLabsStateResetSubset } from './labs-state-reset-subset-fixture.js';

const identity = {
  runId: 'd33-subset-controls',
  caseId: 'labs-state-reset-subset',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D33 subset controls');
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
    (item) => item.definition.id === 'labs-state-reset-subset',
  );
  if (!item || item.definition.profile !== 'legacy-labs-state-reset-subset')
    throw new Error('Missing D33 subset');
  return {
    item,
    data: labsStateResetSubsetDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = legacyLabsStateResetSubset(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observations');
  return { subject, turns: structuredClone([...result.observation]) };
}

test('D33 completes its two-prompt predicate, pins supplied prompts and exact lineage, and composes offline', async () => {
  const { item, data, inputs, expected } = documents();
  expect(item.definition).toMatchObject({
    synthetic: true,
    migration: 'legacy-derived-harness',
    review: 'pending-human-review',
    lineage: [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        pointer: '/items/32',
        taskId: 'cap-maelstrom-multiturn-state-reset',
        datasetId: 'cap-maelstrom-multiturn-state-reset',
      },
    ],
  });
  expect(item.definition.title).toContain('COMPLETE D33');
  expect(item.definition.purpose).toContain(
    'does not establish handler effects',
  );
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Show me the list of my lab results.',
    'Go back to the trends chart.',
  ]);
  expect(expected).toEqual({
    instanceId: 'labs-main',
    actions: ['showList', 'showTrends'],
    variants: ['list', 'trends'],
  });
  expect(data.initial.layout.instances).toEqual([
    { instanceId: 'labs-main', vesselId: 'labs', variant: 'trends' },
  ]);
  const result = await evaluateSample(identity, caseAdapter(item));
  expect(result.evaluation).toBe('pass');
  const { turns } = await evidence();
  expect(turns).toHaveLength(2);
  for (const [index, turn] of turns.entries()) {
    expect(turn.output.executionPlan).toEqual([
      { instanceId: 'labs-main', action: expected.actions[index] },
    ]);
    expect(turn.output.layout.instances[0].variant).toBe(
      expected.variants[index],
    );
    expect(turn.resultingState.layout).toEqual(turn.output.layout);
  }
});

test('D33 requires the right per-turn Action target and first matching tiling layout Variant', async () => {
  const { subject, turns } = await evidence();
  for (const index of [0, 1]) {
    for (const change of [
      (turn: (typeof turns)[number]) => {
        turn.output.executionPlan = [];
      },
      (turn: (typeof turns)[number]) => {
        turn.output.executionPlan[0].instanceId = 'foreign';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.executionPlan[0].action = 'wrong';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances = [];
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[0].instanceId = 'replacement';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.instances[0].variant = 'upload';
      },
      (turn: (typeof turns)[number]) => {
        turn.output.layout.type = 'grid';
      },
    ]) {
      const invalid = structuredClone(turns);
      change(invalid[index]);
      expect(subject.score(invalid).outcome).toBe('fail');
    }
  }
});

test('D33 contains-check permits extra/conflicting Actions and does not score snapshot continuity', async () => {
  const { subject, turns } = await evidence();
  for (const turn of turns) {
    turn.output.executionPlan.unshift({
      instanceId: 'foreign',
      action: 'showUpload',
    });
    turn.output.executionPlan.push({
      instanceId: 'labs-main',
      action: 'showUpload',
    });
    turn.state.layout = { type: 'grid', instances: [] };
    turn.resultingState.layout = {
      type: 'grid',
      instances: [
        { instanceId: 'replacement', vesselId: 'weather', variant: 'current' },
      ],
    };
  }
  expect(subject.score(turns).outcome).toBe('pass');
});

test('D33 preserves source first-match behavior; extra/duplicate membership and Vessel identity are unscored', async () => {
  const { subject, turns } = await evidence();
  for (const turn of turns) {
    turn.output.layout.instances[0].vesselId = 'weather';
    turn.output.layout.instances.push(
      { instanceId: 'foreign', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'labs-main', vesselId: 'labs', variant: 'upload' },
    );
  }
  expect(subject.score(turns).outcome).toBe('pass');
  for (const index of [0, 1]) {
    const invalid = structuredClone(turns);
    invalid[index].output.layout.instances.reverse();
    expect(subject.score(invalid).outcome).toBe('fail');
  }
});

test('D33 scores no third-turn marker validity, positive selection or persistence', async () => {
  const { subject, turns } = await evidence();
  expect(subject.score(turns).outcome).toBe('pass');
  for (const turn of turns)
    turn.output.executionPlan.push({
      instanceId: 'labs-main',
      action: 'selectMarker',
      params: { markerSlug: 'invalid-marker' },
    });
  expect(subject.score(turns).outcome).toBe('pass');
  expect(subject.score([...turns, { ...turns[1], index: 2 }]).outcome).toBe(
    'fail',
  );
  const { expected } = documents();
  expect(
    labsStateResetSubsetExpectationsSchema.safeParse({
      ...expected,
      markerSlug: 'hemoglobin',
    }).success,
  ).toBe(false);
});

test('D33 permits bounded arbitrary JSON params without Action-specific validation', async () => {
  const { item, data } = documents();
  const { subject, turns } = await evidence();
  const extraActions = [
    {
      instanceId: 'labs-main',
      action: 'selectMarkers',
      params: { markerSlugs: ['hemoglobin', 'platelets'] },
    },
    {
      instanceId: 'labs-main',
      action: 'selectMarker',
      params: { markerSlug: { malformed: [true, null, 7] } },
    },
    {
      instanceId: 'foreign',
      action: 'selectMarkers',
      params: {
        markerSlugs: false,
        unrelated: { nested: [{ value: 'ignored' }] },
      },
    },
    ...[
      null,
      false,
      42,
      'unscored',
      ['nested', { values: [null, true] }],
      {},
      { ['k'.repeat(120)]: 's'.repeat(1000) },
      Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `key${index}`,
          Array(20).fill(0),
        ]),
      ),
    ].map((params) => ({ instanceId: 'foreign', action: 'unrelated', params })),
  ];
  for (const [index, turn] of turns.entries()) {
    turn.output.executionPlan.push(
      ...labsStateResetSubsetResponseSchema.shape.executionPlan.parse(
        extraActions,
      ),
    );
    // Parameters on the required navigation Action are also outside this oracle.
    turn.output.executionPlan[0].params = { unrelated: { values: [1, null] } };
    data.responses[index] = structuredClone(turn.output);
  }
  expect(subject.score(turns).outcome).toBe('pass');
  const result = await evaluateSample(
    identity,
    caseAdapter({ ...item, fixture: { ...item.fixture, data } }),
  );
  expect(result.evaluation).toBe('pass');
  expect(result.observation).toEqual(turns);
});

test('D33 rejects oversized, deeply nested and non-JSON params without weakening outer evidence', async () => {
  const { subject, turns } = await evidence();
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const params of [
    { nested: { nested: { nested: { nested: {} } } } },
    [[[[[]]]]],
    Array(21).fill(null),
    Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`key${index}`, null]),
    ),
    { nested: Array(21).fill(null) },
    {
      nested: Object.fromEntries(
        Array.from({ length: 21 }, (_, index) => [`key${index}`, null]),
      ),
    },
    's'.repeat(1001),
    { nested: 's'.repeat(1001) },
    { ['k'.repeat(121)]: null },
    { '': null },
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1n,
    Symbol('invalid'),
    () => null,
    new Date(),
    new Map(),
    new Set(),
    { nested: undefined },
    { nested: () => null },
    { nested: Number.NaN },
    Array(1),
    cycle,
  ]) {
    for (const index of [0, 1]) {
      const invalid = structuredClone(turns);
      const step = { instanceId: 'foreign', action: 'unrelated', params };
      Object.assign(invalid[index].output, {
        executionPlan: [...invalid[index].output.executionPlan, step],
      });
      expect(
        labsStateResetSubsetResponseSchema.safeParse(invalid[index].output)
          .success,
      ).toBe(false);
      expect(subject.score(invalid).outcome).toBe('fail');
    }
  }
  for (const executionPlan of [
    Array(21).fill({ instanceId: 'labs-main', action: 'showList', params: {} }),
    [
      {
        instanceId: 'labs-main',
        action: 'showList',
        params: {},
        unexpected: true,
      },
    ],
  ]) {
    const invalid = structuredClone(turns);
    Object.assign(invalid[0].output, { executionPlan });
    expect(subject.score(invalid).outcome).toBe('fail');
  }
});

test('D33 rejects incomplete, extra, reordered, missing and malformed evidence', async () => {
  const { subject, turns } = await evidence();
  for (const value of [
    null,
    {},
    [],
    turns.slice(0, 1),
    [...turns, turns[1]],
    [...turns].reverse(),
  ])
    expect(subject.score(value as typeof turns).outcome).toBe('fail');
  for (const index of [0, 1]) {
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
      { layout: turns[index].output.layout },
      { ...turns[index].output, executionPlan: [{}] },
      { ...turns[index].output, layout: { type: 'tiling' } },
    ]) {
      const invalid = structuredClone(turns);
      Object.assign(invalid[index], { output });
      expect(subject.score(invalid).outcome).toBe('fail');
    }
    const invalid = structuredClone(turns);
    invalid[index] = { ...invalid[index], input: turns[1 - index].input };
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

test('D33 strict loader/profile schemas reject changed prompts, constraints and unbounded evidence', () => {
  const { item, data, inputs, expected } = documents();
  for (const turns of [
    inputs.turns.slice(0, 1),
    [...inputs.turns, inputs.turns[1]],
    [...inputs.turns].reverse(),
  ])
    expect(labsStateResetSubsetInputsSchema.safeParse({ turns }).success).toBe(
      false,
    );
  for (const expectations of [
    { ...expected, actions: ['showTrends', 'showList'] },
    { ...expected, variants: ['trends', 'list'] },
    { ...expected, scoreThirdTurn: true },
  ])
    expect(() =>
      caseAdapter({
        ...item,
        definition: { ...item.definition, expectations },
      } as typeof item),
    ).toThrow();
  expect(() =>
    caseAdapter({
      ...item,
      fixture: { ...item.fixture, kind: 'labs-select-marker-script' },
    }),
  ).toThrow();
  for (const change of [
    (value: typeof data) => {
      value.responses.pop();
    },
    (value: typeof data) => {
      value.initial.layout.instances[0].variant = 'list';
    },
    (value: typeof data) => {
      value.responses[0].executionPlan = Array(21).fill({
        instanceId: 'labs-main',
        action: 'showList',
      });
    },
    (value: typeof data) => {
      value.responses[0].layout.instances = Array(21).fill(
        value.initial.layout.instances[0],
      );
    },
  ]) {
    const invalid = structuredClone(data);
    change(invalid);
    expect(() =>
      caseAdapter({ ...item, fixture: { ...item.fixture, data: invalid } }),
    ).toThrow();
  }
});

test('D33 independent script/expectations mutations change verdicts, never manufacture responses', async () => {
  const { data, inputs, expected } = documents();
  const baseline = await evaluateSample(
    identity,
    legacyLabsStateResetSubset(data, inputs, expected),
  );
  const changedExpectation = await evaluateSample(
    identity,
    legacyLabsStateResetSubset(data, inputs, {
      ...expected,
      instanceId: 'other',
    }),
  );
  expect(changedExpectation.observation).toEqual(baseline.observation);
  expect(changedExpectation.evaluation).toBe('fail');
  data.responses[1].executionPlan = [];
  const changedResponse = await evaluateSample(
    identity,
    legacyLabsStateResetSubset(data, inputs, expected),
  );
  expect(changedResponse.evaluation).toBe('fail');
  expect(changedResponse.observation?.[1].output.executionPlan).toEqual([]);
});
