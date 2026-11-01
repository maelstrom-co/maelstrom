import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type GridNoOverlapResponse,
  type GridNoOverlapState,
  gridNoOverlapDataSchema,
  gridNoOverlapExpectationsSchema,
  gridNoOverlapLayoutFailures,
} from '../../packages/evals/src/adapters/legacy-grid-no-overlap.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  type GridNoOverlapTurn,
  legacyGridNoOverlap,
} from './grid-no-overlap-fixture.js';

const identity = {
  runId: 'grid-controls',
  caseId: 'grid-no-overlap',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in grid controls');
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
    (item) => item.definition.id === 'grid-no-overlap',
  );
  if (!item || item.definition.profile !== 'legacy-grid-no-overlap')
    throw new Error('Missing grid case');
  return {
    data: gridNoOverlapDataSchema.parse(item.fixture.data),
    input: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, input, expected } = documents();
  const subject = legacyGridNoOverlap(data, input, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing grid evidence');
  return { subject, turns: structuredClone([...result.observation]) };
}
function sparseLayout(): GridNoOverlapState['layout'] {
  const { data } = documents();
  const cells = [
    [0, 0],
    [0, 15],
    [11, 0],
    [11, 15],
    [5, 7],
  ];
  return {
    type: 'grid',
    positions: data.instances.map((item, i) => ({
      instanceId: item.instanceId,
      position: { row: cells[i][0], column: cells[i][1] },
      size: { width: 1, height: 1 },
    })),
  };
}

test('D13 pins the dataset prompt, source Chart and known Instances, retaining undersized Labs without a min-size claim', async () => {
  const { data, input, expected } = documents();
  expect(input.intent).toBe('Place 5 vessels in compact grid');
  expect(data.chartDimensions).toEqual({ rows: 12, columns: 16 });
  expect(expected.chartDimensions).toEqual(data.chartDimensions);
  expect(data.instances).toEqual([
    { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    { instanceId: 'labs-main', vesselId: 'labs', variant: 'trends' },
    { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
    { instanceId: 'email-main', vesselId: 'email', variant: 'inbox' },
    { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'pending' },
  ]);
  expect(expected.instanceIds).toEqual(
    data.instances.map((item) => item.instanceId),
  );
  expect(
    data.initial.layout.positions.find(
      (item) => item.instanceId === 'labs-main',
    )?.size,
  ).toEqual({ width: 8, height: 4 });
  const { turns } = await evidence();
  expect(turns[0].state).toEqual(data.initial);
  expect(turns[0].output).toEqual(data.response);
  expect(turns[0].resultingState.layout).toEqual(data.response.layout);
});

test('D13 accepts reordered positions, alternate placements, shared edges and Chart boundary contact', async () => {
  const { data, input, expected } = documents();
  const swapped = structuredClone(data.response.layout);
  [swapped.positions[0].instanceId, swapped.positions[1].instanceId] = [
    swapped.positions[1].instanceId,
    swapped.positions[0].instanceId,
  ];
  for (const layout of [
    data.response.layout,
    {
      ...data.response.layout,
      positions: [...data.response.layout.positions].reverse(),
    },
    swapped,
  ]) {
    data.response.layout = layout;
    const result = await evaluateSample(
      identity,
      legacyGridNoOverlap(data, input, expected),
    );
    expect(result.evaluation).toBe('pass');
  }
  expect(gridNoOverlapLayoutFailures(sparseLayout(), expected)).toEqual([]);
});

test('D13 accepts noncompact one-cell allocations: minimum sizes and packing quality are not scored', async () => {
  const { data, input, expected } = documents();
  data.response.layout = sparseLayout();
  const result = await evaluateSample(
    identity,
    legacyGridNoOverlap(data, input, expected),
  );
  expect(result.evaluation).toBe('pass');
  expect(
    result.observation?.[0].output.layout.positions.every(
      (item) => item.size.width === 1 && item.size.height === 1,
    ),
  ).toBe(true);
});

test('D13 rejects intersections including containment and one-cell overlap, but not merely touching edges', async () => {
  const { subject, turns } = await evidence();
  for (const field of ['output', 'resultingState'] as const) {
    for (const [index, position] of [
      [1, { row: 0, column: 7 }],
      [2, { row: 3, column: 0 }],
      [4, { row: 7, column: 0 }],
    ] as const) {
      const changed = structuredClone(turns);
      changed[0][field].layout.positions[index].position = position;
      expect(subject.score(changed).failures).toContain(
        `${field === 'output' ? 'Response' : 'Retained state'}: Grid positions overlap`,
      );
    }
    const contained = structuredClone(turns);
    contained[0][field].layout.positions[1].position = { row: 1, column: 1 };
    contained[0][field].layout.positions[1].size = { width: 1, height: 1 };
    expect(subject.score(contained).outcome).toBe('fail');
  }
});

test('D13 validates numeric cells and bounds before overlap arithmetic', async () => {
  const { subject, turns } = await evidence();
  for (const field of ['output', 'resultingState'] as const) {
    for (const coordinate of ['row', 'column'] as const) {
      for (const value of [
        -1,
        -0.5,
        0.5,
        1_000_000,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        const changed = structuredClone(turns);
        changed[0][field].layout.positions[0].position[coordinate] = value;
        expect(subject.score(changed).outcome).toBe('fail');
      }
    }
    for (const dimension of ['width', 'height'] as const) {
      for (const value of [
        0,
        -1,
        0.5,
        1_000_000,
        Number.NaN,
        Number.NEGATIVE_INFINITY,
      ]) {
        const changed = structuredClone(turns);
        changed[0][field].layout.positions[0].size[dimension] = value;
        expect(subject.score(changed).outcome).toBe('fail');
      }
    }
    for (const size of [
      { width: 17, height: 4 },
      { width: 16, height: 5 },
    ]) {
      const changed = structuredClone(turns);
      changed[0][field].layout.positions[4].size = size;
      expect(subject.score(changed).failures).toContain(
        `${field === 'output' ? 'Response' : 'Retained state'}: Grid position exceeds Chart bounds`,
      );
    }
  }
});

test('D13 rejects hidden/missing, duplicate, extra and unknown positions independently of retained metadata', async () => {
  const { subject, turns } = await evidence();
  const changes: ((layout: GridNoOverlapState['layout']) => void)[] = [
    (layout) => {
      layout.positions.pop();
    },
    (layout) => {
      layout.positions = [];
    },
    (layout) => {
      layout.positions[1].instanceId = layout.positions[0].instanceId;
    },
    (layout) => {
      layout.positions[0].instanceId = 'unknown';
    },
    (layout) => {
      layout.positions.push({
        instanceId: 'extra',
        position: { row: 10, column: 10 },
        size: { width: 1, height: 1 },
      });
    },
    (layout) => {
      layout.type = 'tiling';
    },
  ];
  for (const change of changes) {
    for (const field of ['state', 'output', 'resultingState'] as const) {
      const changed = structuredClone(turns);
      change(changed[0][field].layout);
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
});

test('D13 has no Action or empty-plan requirement; plans cannot repair invalid allocations', async () => {
  for (const executionPlan of [
    [],
    [{ instanceId: 'unverified', action: 'unverifiedAction' }],
  ]) {
    const { data, input, expected } = documents();
    data.response.executionPlan = executionPlan;
    expect(
      (
        await evaluateSample(
          identity,
          legacyGridNoOverlap(data, input, expected),
        )
      ).evaluation,
    ).toBe('pass');
    data.response.layout.positions.pop();
    expect(
      (
        await evaluateSample(
          identity,
          legacyGridNoOverlap(data, input, expected),
        )
      ).evaluation,
    ).toBe('fail');
  }
});

test('D13 fails closed for malformed/oversized evidence, changed initial state, prompt/index and incomplete execution', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [null, {}, [], [...turns, turns[0]]])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (const field of ['index', 'input', 'state', 'output', 'resultingState']) {
    const changed = structuredClone(turns);
    delete (changed[0] as unknown as Record<string, unknown>)[field];
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const positions of [
    null,
    {},
    [],
    Array(21).fill(turns[0].output.layout.positions[0]),
    [{ instanceId: 'weather-main' }],
  ]) {
    const changed = structuredClone(turns);
    Object.assign(changed[0].output.layout, { positions });
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const field of ['state', 'output', 'resultingState'] as const) {
    for (const member of ['positions', 'type']) {
      const changed = structuredClone(turns);
      delete (changed[0][field].layout as Record<string, unknown>)[member];
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
  const missing = structuredClone(turns);
  delete (missing[0].output as Partial<GridNoOverlapResponse>).executionPlan;
  expect(subject.score(missing).outcome).toBe('fail');
  const changed = structuredClone(turns);
  changed[0].state.layout = sparseLayout();
  expect(subject.score(changed).failures).toContain(
    'Changed initial grid evidence',
  );
  changed[0] = { ...changed[0], state: structuredClone(turns[0].state) };
  changed[0].input.intent = 'other';
  expect(subject.score(changed).outcome).toBe('fail');
  expect(
    subject.score([{ ...turns[0], index: 1 }] as GridNoOverlapTurn[]).outcome,
  ).toBe('fail');
  for (const completeness of ['partial', 'absent'] as const) {
    const result = await evaluateSample(identity, {
      ...subject,
      execute: async () => ({
        completeness,
        disposition: 'planned',
        value: turns,
      }),
      score: () => {
        throw new Error('Must not score missing evidence');
      },
    });
    expect(result.evaluation).toBe('unscored');
    expect(result.error).toBeUndefined();
  }
});

test('D13 expectations cannot manufacture observations or silently replace the fixture Chart/known identity contract', async () => {
  const { data, input, expected } = documents();
  const first = await evaluateSample(
    identity,
    legacyGridNoOverlap(data, input, expected),
  );
  const different = structuredClone(expected);
  different.instanceIds[0] = 'replacement';
  const changed = await evaluateSample(
    identity,
    legacyGridNoOverlap(data, input, different),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(first.observation);
  const smaller = structuredClone(expected);
  smaller.chartDimensions.rows = 11;
  const bounds = await evaluateSample(
    identity,
    legacyGridNoOverlap(data, input, smaller),
  );
  expect(bounds.evaluation).toBe('fail');
  expect(bounds.observation).toEqual(first.observation);
  expect(
    gridNoOverlapExpectationsSchema.safeParse({
      ...expected,
      instanceIds: Array(5).fill('same'),
    }).success,
  ).toBe(false);
  expect(
    gridNoOverlapExpectationsSchema.safeParse({
      ...expected,
      chartDimensions: { rows: 0, columns: 16 },
    }).success,
  ).toBe(false);
});

test('D13 resets samples and accepts consistent identity renaming and independent position ordering', async () => {
  const { data, input, expected } = documents();
  const subject = legacyGridNoOverlap(data, input, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.evaluation).toBe('pass');
  expect(second.observation).toEqual(first.observation);
  expect(first.observation?.[0].output.layout).not.toBe(
    first.observation?.[0].resultingState.layout,
  );
  data.instances[0].instanceId = 'weather-renamed';
  for (const layout of [data.initial.layout, data.response.layout])
    layout.positions[0].instanceId = 'weather-renamed';
  expected.instanceIds[0] = 'weather-renamed';
  expected.instanceIds.reverse();
  data.response.layout.positions.reverse();
  expect(
    (await evaluateSample(identity, legacyGridNoOverlap(data, input, expected)))
      .evaluation,
  ).toBe('pass');
});
