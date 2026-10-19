import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { strictTilingLayoutFailures } from '../../packages/evals/src/adapters/legacy-tiling-add-vessel.js';
import {
  strictBinaryTilingLayoutFailures,
  type TilingTreeResponse,
  type TilingTreeState,
  tilingTreeDataSchema,
  tilingTreeExpectationsSchema,
} from '../../packages/evals/src/adapters/legacy-tiling-tree-validity.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyTilingTreeValidity,
  type TilingTreeTurn,
} from './tiling-tree-validity-fixture.js';

const identity = {
  runId: 'binary-tree-controls',
  caseId: 'tiling-tree-validity',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in binary-tree controls');
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
    (item) => item.definition.id === 'tiling-tree-validity',
  );
  if (!item || item.definition.profile !== 'legacy-tiling-tree-validity')
    throw new Error('Missing binary-tree case');
  return {
    data: tilingTreeDataSchema.parse(item.fixture.data),
    input: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, input, expected } = documents();
  const subject = legacyTilingTreeValidity(data, input, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing evidence');
  return { subject, turns: structuredClone([...result.observation]) };
}
const w = 'ID:weather-main';
const l = 'ID:labs-main';

test('D12 pins the add-Labs prompt and current fixture identities in response and retained state', async () => {
  const { input, expected } = documents();
  expect(input.intent).toBe('Add my lab results to the view');
  expect(expected).toEqual({
    retainedInstance: {
      instanceId: 'weather-main',
      vesselId: 'weather',
      variant: 'current',
    },
    addedInstance: {
      instanceId: 'labs-main',
      vesselId: 'labs',
      variant: 'trends',
    },
  });
  const { turns } = await evidence();
  expect(turns[0].state.layout.instances).toEqual([expected.retainedInstance]);
  expect(turns[0].output.layout).toEqual({
    type: 'tiling',
    tree: ['V', w, l],
    instances: [expected.retainedInstance, expected.addedInstance],
  });
  expect(turns[0].resultingState.layout).toEqual(turns[0].output.layout);
});

test('D12 accepts either axis, reversed leaves, unequal binary weights, nesting and null slots without the old array-depth limit', async () => {
  for (const tree of [
    ['H', l, w],
    ['V:2,1', w, l],
    ['H:1,1000', l, w],
    ['V:1,1', w, l],
    ['H', null, 'V:3,2', l, w],
    ['V', 'H', w, null, 'V', null, l],
    [...Array.from({ length: 126 }, () => ['H', null]).flat(), 'V', w, l],
  ]) {
    const { data, input, expected } = documents();
    data.response.layout.tree = tree;
    data.response.layout.instances.reverse();
    expect(
      (
        await evaluateSample(
          identity,
          legacyTilingTreeValidity(data, input, expected),
        )
      ).evaluation,
    ).toBe('pass');
  }
});

test('D12 binary subset rejects a valid ternary tree that the unchanged general D37 parser accepts', async () => {
  const { data } = documents();
  const ternary = { ...data.response.layout, tree: ['V:1,1,1', w, l, null] };
  expect(strictTilingLayoutFailures(ternary)).toEqual([]);
  expect(strictBinaryTilingLayoutFailures(ternary)).toEqual([
    'Binary-subset evaluation requires exactly two children per split',
  ]);
  const { subject, turns } = await evidence();
  turns[0].output.layout = ternary;
  expect(subject.score(turns).outcome).toBe('fail');
  const d37 = loadOfflineCases().find(
    (item) => item.definition.id === 'tiling-add-vessel',
  );
  if (!d37) throw new Error('Missing D37');
  expect(d37.fixture.data).toMatchObject({
    response: {
      layout: {
        tree: [
          'V:1,1,1',
          'ID:weather-main',
          'ID:labs-main',
          'ID:calendar-added',
        ],
      },
    },
  });
  expect(
    (
      await evaluateSample(
        { ...identity, caseId: 'tiling-add-vessel' },
        caseAdapter(d37),
      )
    ).evaluation,
  ).toBe('pass');
});

test('D12 rejects hidden metadata, invalid tokens/weights, non-binary splits, partial and trailing roots', async () => {
  const { subject, turns } = await evidence();
  const trees: TilingTreeState['layout']['tree'][] = [
    [],
    [null],
    [w],
    [l],
    ['V', w, w],
    ['V', w, 'ID:ghost'],
    ['V', 'weather-main', l],
    ['V', w, 'ID:'],
    ['H:1,1,1', w, l, null],
    ['V:1,1,1,1', w, l, null, null],
    ['V:abc', w, l],
    ['V:0,1', w, l],
    ['V:1.5,1', w, l],
    ['V:01,1', w, l],
    ['V:1e2,1', w, l],
    ['V:1001,1', w, l],
    ['V:-1,1', w, l],
    ['V:1,1,', w, l],
    ['V:1', w, l],
    ['V:', w, l],
    ['V:1,1,1,1,1,1,1,1,1,1,1,1,1', w, l, ...Array(11).fill(null)],
    ['V'],
    ['V', w],
    ['V', w, 'H', l],
    ['V', w, l, null],
    ['V', w, l, 'ID:ghost'],
  ];
  for (const tree of trees)
    for (const field of ['output', 'resultingState'] as const) {
      const changed = structuredClone(turns);
      changed[0][field].layout.tree = tree;
      expect(subject.score(changed).outcome).toBe('fail');
    }
});

test('D12 enforces exact Weather preservation and fresh Labs/trends independently of valid binary structure', async () => {
  const { subject, turns } = await evidence();
  const changes: ((layout: TilingTreeState['layout']) => void)[] = [
    (layout) => {
      layout.instances.pop();
      layout.tree = [w];
    },
    (layout) => {
      layout.instances.shift();
      layout.tree = [l];
    },
    (layout) => {
      layout.instances[0].instanceId = 'replacement';
      layout.tree[1] = 'ID:replacement';
    },
    (layout) => {
      layout.instances[1].instanceId = 'other-labs';
      layout.tree[2] = 'ID:other-labs';
    },
    (layout) => {
      layout.instances[0].vesselId = 'labs';
    },
    (layout) => {
      layout.instances[1].vesselId = 'weather';
    },
    (layout) => {
      layout.instances[0].variant = 'weekly';
    },
    (layout) => {
      layout.instances[1].variant = 'upload';
    },
    (layout) => {
      layout.instances[1].instanceId = 'weather-main';
      layout.tree[2] = w;
    },
    (layout) => {
      layout.instances.push({ ...layout.instances[0], instanceId: 'extra' });
      layout.tree = ['V', w, 'H', l, 'ID:extra'];
    },
    (layout) => {
      layout.instances.push({ ...layout.instances[0] });
    },
    (layout) => {
      layout.type = 'grid';
    },
  ];
  for (const change of changes)
    for (const field of ['output', 'resultingState'] as const) {
      const changed = structuredClone(turns);
      change(changed[0][field].layout);
      expect(subject.score(changed).outcome).toBe('fail');
    }
  const before = structuredClone(turns);
  before[0].state.layout.instances[0].variant = 'weekly';
  expect(subject.score(before).outcome).toBe('fail');
  before[0].state.layout.instances[0].variant = 'current';
  before[0].state.layout.tree = [null];
  expect(subject.score(before).outcome).toBe('fail');
  const { data, input, expected } = documents();
  const reused = {
    ...expected,
    addedInstance: { ...expected.addedInstance, instanceId: 'weather-main' },
  };
  expect(tilingTreeExpectationsSchema.safeParse(reused).success).toBe(false);
  expect(() => legacyTilingTreeValidity(data, input, reused)).toThrow();
});

test('D12 is layout-only: empty and nonempty plans have identical passing and failing verdicts', async () => {
  for (const executionPlan of [
    [],
    [{ instanceId: 'unverified-target', action: 'unverifiedAction' }],
  ]) {
    const { data, input, expected } = documents();
    data.response.executionPlan = executionPlan;
    expect(
      (
        await evaluateSample(
          identity,
          legacyTilingTreeValidity(data, input, expected),
        )
      ).evaluation,
    ).toBe('pass');
    data.response.layout.tree = [l];
    expect(
      (
        await evaluateSample(
          identity,
          legacyTilingTreeValidity(data, input, expected),
        )
      ).evaluation,
    ).toBe('fail');
  }
});

test('D12 rejects missing/malformed/oversized evidence and changed request/index without scoring errors', async () => {
  const { subject, turns } = await evidence();
  for (const invalid of [null, {}, [], [...turns, turns[0]]])
    expect(subject.score(invalid as typeof turns).outcome).toBe('fail');
  for (const field of ['index', 'input', 'state', 'output', 'resultingState']) {
    const changed = structuredClone(turns);
    delete (changed[0] as unknown as Record<string, unknown>)[field];
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const tree of [
    null,
    'not-an-array',
    [['V', w, l]],
    Array(257).fill(null),
    ['V:'.padEnd(257, '1')],
  ]) {
    const changed = structuredClone(turns);
    Object.assign(changed[0].output.layout, { tree });
    expect(subject.score(changed).outcome).toBe('fail');
    expect(
      strictBinaryTilingLayoutFailures(changed[0].output.layout).length,
    ).toBeGreaterThan(0);
  }
  for (const field of ['state', 'output', 'resultingState'] as const) {
    for (const member of ['tree', 'instances', 'type']) {
      const changed = structuredClone(turns);
      delete (changed[0][field].layout as Record<string, unknown>)[member];
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
  const missing = structuredClone(turns);
  delete (missing[0].output as Partial<TilingTreeResponse>).executionPlan;
  expect(subject.score(missing).outcome).toBe('fail');
  const prompt = structuredClone(turns);
  prompt[0].input.intent = 'other';
  expect(subject.score(prompt).outcome).toBe('fail');
  expect(
    subject.score([{ ...turns[0], index: 1 }] as TilingTreeTurn[]).outcome,
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
        throw new Error('Must not score incomplete evidence');
      },
    });
    expect(result.evaluation).toBe('unscored');
    expect(result.error).toBeUndefined();
  }
});

test('D12 resets snapshots independently and expectations cannot manufacture matching identities or trees', async () => {
  const { data, input, expected } = documents();
  const subject = legacyTilingTreeValidity(data, input, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation).toEqual(first.observation);
  expect(first.observation?.[0].output.layout).not.toBe(
    first.observation?.[0].resultingState.layout,
  );
  expected.addedInstance.instanceId = 'labs-other';
  const changed = await evaluateSample(
    identity,
    legacyTilingTreeValidity(data, input, expected),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(first.observation);
  data.response.layout.instances[1].instanceId = 'labs-other';
  data.response.layout.tree[2] = 'ID:labs-other';
  expect(
    (
      await evaluateSample(
        identity,
        legacyTilingTreeValidity(data, input, expected),
      )
    ).evaluation,
  ).toBe('pass');
});
