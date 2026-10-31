import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  strictTilingLayoutFailures,
  type TilingAddResponse,
  type TilingAddState,
  tilingAddDataSchema,
  tilingAddExpectationsSchema,
} from '../../packages/evals/src/adapters/legacy-tiling-add-vessel.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyTilingAddVessel,
  type TilingAddTurn,
} from './tiling-add-vessel-fixture.js';

const identity = {
  runId: 'tiling-add-controls',
  caseId: 'tiling-add-vessel',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in tiling-add controls');
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
    (item) => item.definition.id === 'tiling-add-vessel',
  );
  if (!item || item.definition.profile !== 'legacy-tiling-add-vessel')
    throw new Error('Missing tiling-add case');
  return {
    data: tilingAddDataSchema.parse(item.fixture.data),
    input: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, input, expected } = documents();
  const subject = legacyTilingAddVessel(data, input, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing evidence');
  return { subject, turns: structuredClone([...result.observation]) };
}
const w = 'ID:weather-main';
const l = 'ID:labs-main';
const c = 'ID:calendar-added';

test('D37 retains the source prompt and adds a fresh synthetic Calendar ID to both output and retained tree', async () => {
  const { input, expected } = documents();
  expect(input.intent).toBe('Add my calendar to the view too');
  expect(expected.addedInstance).toEqual({
    instanceId: 'calendar-added',
    vesselId: 'calendar',
    variant: 'month',
  });
  const { turns } = await evidence();
  expect(
    turns[0].state.layout.instances.map((item) => item.instanceId),
  ).toEqual(['weather-main', 'labs-main']);
  expect(turns[0].output.layout.instances).toEqual([
    ...expected.retainedInstances,
    expected.addedInstance,
  ]);
  expect(turns[0].output.layout.tree).toEqual(['V:1,1,1', w, l, c]);
  expect(turns[0].resultingState.layout).toEqual(turns[0].output.layout);
});

test('D37 accepts binary, nested, weighted n-ary and null-slot layouts without prescribing shape', async () => {
  const trees = [
    ['V', w, 'H', l, c],
    ['H:2,1', 'V:3,1', c, w, l],
    ['H:1,1,1', c, l, w],
    ['V:2,3,4', w, l, c],
    ['V:1,1,1,1', w, null, l, c],
    ['H', null, 'V:1,1,1', c, w, l],
    [
      ...Array.from({ length: 126 }, () => ['H', null]).flat(),
      'V:1,1,1',
      w,
      l,
      c,
    ],
    ['V:1,1,1,1,1,1,1,1,1,1,1,1000', w, l, c, ...Array(9).fill(null)],
  ];
  for (const tree of trees) {
    const { data, input, expected } = documents();
    data.response.layout.tree = tree;
    data.response.layout.instances.reverse();
    const result = await evaluateSample(
      identity,
      legacyTilingAddVessel(data, input, expected),
    );
    expect(result.evaluation).toBe('pass');
  }
});

test('D37 rejects hidden retained metadata, malformed tokens, repaired splits, incomplete roots and trailing trees', async () => {
  const { subject, turns } = await evidence();
  const trees: TilingAddState['layout']['tree'][] = [
    [],
    [null],
    [c],
    ['V', w, c],
    ['V', l, c],
    ['V:1,1,1', w, w, c],
    ['V:1,1,1', w, l, 'ID:ghost'],
    ['V:1,1,1', 'weather-main', l, c],
    ['V:1,1,1', w, l, 'ID:'],
    ['V:abc', w, 'H', l, c],
    ['V:0,1,1', w, l, c],
    ['V:1.5,1,1', w, l, c],
    ['V:01,1,1', w, l, c],
    ['V:1e2,1,1', w, l, c],
    ['V:1001,1,1', w, l, c],
    ['V:-1,1,1', w, l, c],
    ['V:1,1,', w, 'H', l, c],
    ['V:1', w, 'H', l, c],
    ['V:', w, 'H', l, c],
    ['V:1,1,1,1,1,1,1,1,1,1,1,1,1', w, l, c, ...Array(10).fill(null)],
    ['V:1,1,1', w, l],
    ['V', w, 'H', l],
    ['V:1,1,1', w, l, c, null],
    ['V', w, l, c],
    ['V:1,1,1', w, l, c, 'ID:ghost'],
  ];
  for (const tree of trees)
    for (const field of ['output', 'resultingState'] as const) {
      const changed = structuredClone(turns);
      changed[0][field].layout.tree = tree;
      const verdict = subject.score(changed);
      expect(verdict.outcome).toBe('fail');
      expect(verdict.failures.length).toBeGreaterThan(0);
    }
});

test('D37 exact add-and-retain membership rejects identity reuse, replacements and state changes independently of tree validity', async () => {
  const { subject, turns } = await evidence();
  const changes: ((layout: TilingAddState['layout']) => void)[] = [
    (layout) => {
      layout.instances.pop();
      layout.tree = ['V', w, l];
    },
    (layout) => {
      layout.instances.shift();
      layout.tree = ['V', l, c];
    },
    (layout) => {
      layout.instances[0].instanceId = 'replacement';
      layout.tree[1] = 'ID:replacement';
    },
    (layout) => {
      layout.instances[0].vesselId = 'calendar';
    },
    (layout) => {
      layout.instances[0].variant = 'weekly';
    },
    (layout) => {
      layout.instances[1].variant = 'upload';
    },
    (layout) => {
      layout.instances[2].variant = 'week';
    },
    (layout) => {
      layout.instances[2].vesselId = 'labs';
    },
    (layout) => {
      layout.instances[2].instanceId = 'weather-main';
      layout.tree[3] = w;
    },
    (layout) => {
      layout.instances.push({ ...layout.instances[0], instanceId: 'extra' });
      layout.tree = ['V:1,1,1,1', w, l, c, 'ID:extra'];
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
  const changed = structuredClone(turns);
  changed[0].state.layout.instances[0].variant = 'weekly';
  expect(subject.score(changed).outcome).toBe('fail');
  const { data, input, expected } = documents();
  for (const reusedId of ['weather-main', 'labs-main']) {
    const reused = {
      ...expected,
      addedInstance: { ...expected.addedInstance, instanceId: reusedId },
    };
    expect(tilingAddExpectationsSchema.safeParse(reused).success).toBe(false);
    expect(() => legacyTilingAddVessel(data, input, reused)).toThrow();
  }
});

test('D37 has no Action requirement: empty and nonempty plans have identical layout verdicts', async () => {
  const { data, input, expected } = documents();
  for (const executionPlan of [
    [],
    [{ instanceId: 'unverified-target', action: 'unverifiedAction' }],
  ]) {
    data.response.executionPlan = executionPlan;
    const result = await evaluateSample(
      identity,
      legacyTilingAddVessel(data, input, expected),
    );
    expect(result.evaluation).toBe('pass');
    data.response.layout.tree = [c];
    expect(
      (
        await evaluateSample(
          identity,
          legacyTilingAddVessel(data, input, expected),
        )
      ).evaluation,
    ).toBe('fail');
    data.response.layout.tree = ['V:1,1,1', w, l, c];
  }
});

test('D37 rejects missing/malformed/oversized evidence, wrong prompt/index and incomplete execution', async () => {
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
      strictTilingLayoutFailures(changed[0].output.layout).length,
    ).toBeGreaterThan(0);
  }
  for (const field of ['tree', 'instances', 'type']) {
    const changed = structuredClone(turns);
    delete (changed[0].output.layout as Record<string, unknown>)[field];
    expect(subject.score(changed).outcome).toBe('fail');
  }
  const missing = structuredClone(turns);
  delete (missing[0].output as Partial<TilingAddResponse>).executionPlan;
  expect(subject.score(missing).outcome).toBe('fail');
  const prompt = structuredClone(turns);
  prompt[0].input.intent = 'other';
  expect(subject.score(prompt).outcome).toBe('fail');
  const wrongIndex = [{ ...turns[0], index: 1 }] as TilingAddTurn[];
  expect(subject.score(wrongIndex).outcome).toBe('fail');
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

test('D37 snapshots reset independently and expectations cannot manufacture a passing tree or new identity', async () => {
  const { data, input, expected } = documents();
  const subject = legacyTilingAddVessel(data, input, expected);
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation).toEqual(first.observation);
  expect(first.observation?.[0].output.layout).not.toBe(
    first.observation?.[0].resultingState.layout,
  );
  expected.addedInstance.instanceId = 'calendar-other';
  const changed = await evaluateSample(
    identity,
    legacyTilingAddVessel(data, input, expected),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(first.observation);
  data.response.layout.instances[2].instanceId = 'calendar-other';
  data.response.layout.tree[3] = 'ID:calendar-other';
  expect(
    (
      await evaluateSample(
        identity,
        legacyTilingAddVessel(data, input, expected),
      )
    ).evaluation,
  ).toBe('pass');
});
