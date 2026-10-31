import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  weatherNavigationTransitions,
  weatherTransitionChainDataSchema,
  weatherTransitionChainExpectationsSchema,
  weatherTransitionChainInputsSchema,
  weatherTransitionChainObservationSchema,
} from '../../packages/evals/src/adapters/legacy-weather-transition-chain.js';
import { validateLoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import { legacyWeatherTransitionChain } from './weather-transition-chain-fixture.js';

const ids = [
  'weather-deterministic-cycle',
  'weather-deterministic-return',
] as const;
const identity = {
  runId: 'weather-chain-controls',
  caseId: ids[0],
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in Weather chain controls');
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
function documents(id: string) {
  const item = loadOfflineCases().find((item) => item.definition.id === id);
  if (!item || item.definition.profile !== 'legacy-weather-transition-chain')
    throw new Error('Missing chain');
  return {
    item: { ...item, definition: item.definition },
    data: weatherTransitionChainDataSchema.parse(item.fixture.data),
    inputs: weatherTransitionChainInputsSchema.parse(item.definition.inputs),
    expected: weatherTransitionChainExpectationsSchema.parse(
      item.definition.expectations,
    ),
  };
}
async function evidence(id: string) {
  const { item, data, inputs, expected } = documents(id);
  const adapter = legacyWeatherTransitionChain(data, inputs, expected);
  const result = await evaluateSample(
    { ...identity, caseId: id },
    caseAdapter(item),
  );
  expect(result.evaluation).toBe('pass');
  expect(result.records).toHaveLength(3);
  return {
    adapter,
    turns: weatherTransitionChainObservationSchema.parse(result.observation),
  };
}

test('D40/D41 retain separate pointers, exact prompts, scorer corrections and ordered scripted states', async () => {
  for (const [index, id] of ids.entries()) {
    const { item, inputs, expected } = documents(id);
    expect(item.definition.lineage[0]).toEqual({
      source: 'legacy',
      revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
      path: 'langfuse/maelstrom-eval-dataset.v1.json',
      taskId: 'cap-maelstrom-edge-deterministic-actions',
      datasetId: 'cap-maelstrom-edge-deterministic-actions',
      pointer: `/items/${index + 39}`,
    });
    expect(inputs.turns.map(({ intent }) => intent)).toEqual(
      index === 0
        ? [
            'Show me the hourly forecast',
            'Now go straight to weekly',
            'Go back to current',
          ]
        : [
            'Show hourly',
            'Just show current right now - skip weekly',
            'Go to weekly',
          ],
    );
    expect(item.definition.review).toBe('pending-human-review');
    expect(expected.coverage).toBe('COMPLETE');
    const { turns } = await evidence(id);
    expect(turns.map((turn) => turn.state.layout.instances[0].variant)).toEqual(
      ['current', ...expected.variants.slice(0, 2)],
    );
    expect(
      turns.map((turn) => turn.resultingState.layout.instances[0].variant),
    ).toEqual(expected.variants);
    expect(turns.map((turn) => turn.output.executionPlan[0].action)).toEqual(
      expected.actions,
    );
  }
  expect(documents(ids[0]).item.definition.purpose).toContain(
    'historical scorer compatibility is out of scope',
  );
});

test('navigation table matches the actual current Weather definitions without loading handlers', async () => {
  const url = new URL(
    '../../apps/demo/src/vessels/weather.vessel.def.ts',
    import.meta.url,
  );
  const { weatherVessel } = await import(url.href);
  const transitions = Object.fromEntries(
    Object.entries(weatherVessel.variants).map(([variant, value]) => [
      variant,
      Object.fromEntries(
        (
          value as { actions: { name: string; transitionsTo?: string }[] }
        ).actions
          .filter((action) => action.transitionsTo)
          .map((action) => [action.name, action.transitionsTo]),
      ),
    ]),
  );
  expect(transitions).toEqual(weatherNavigationTransitions);
});

test('both chains reject missing/extra/wrong-target Actions and any unexpected parameters', async () => {
  for (const id of ids) {
    const { adapter, turns } = await evidence(id);
    for (let index = 0; index < 3; index++) {
      const action = turns[index].output.executionPlan[0];
      for (const plan of [
        [],
        [action, action],
        [{ ...action, instanceId: 'foreign' }],
        [{ ...action, action: 'unknown' }],
        [{ ...action, params: null }],
        [{ ...action, params: {} }],
      ]) {
        const changed = structuredClone(turns);
        changed[index].output.executionPlan = plan;
        expect(adapter.score(changed).outcome).toBe('fail');
      }
    }
  }
});

test('incoming Variants, retained snapshots and exact singleton membership cannot silently change', async () => {
  for (const id of ids) {
    const { adapter, turns } = await evidence(id);
    for (let index = 0; index < 3; index++) {
      for (const field of ['state', 'output', 'resultingState'] as const) {
        for (const corruption of [
          'type',
          'missing',
          'extra',
          'id',
          'vessel',
          'variant',
        ]) {
          const changed = structuredClone(turns);
          const layout = changed[index][field].layout;
          if (corruption === 'type') layout.type = 'grid';
          if (corruption === 'missing') layout.instances = [];
          if (corruption === 'extra')
            layout.instances.push({ ...layout.instances[0] });
          if (corruption === 'id') layout.instances[0].instanceId = 'other';
          if (corruption === 'vessel') layout.instances[0].vesselId = 'other';
          if (corruption === 'variant') layout.instances[0].variant = 'wrong';
          expect(adapter.score(changed).outcome).toBe('fail');
        }
      }
    }
    const legacySequence = structuredClone(turns);
    legacySequence[1].output.layout.instances[0].variant = 'current';
    legacySequence[1].output.executionPlan[0].action = 'showCurrent';
    if (id === ids[0])
      expect(adapter.score(legacySequence).outcome).toBe('fail');
  }
});

test('missing/malformed/reordered evidence and mismatched source contracts fail closed', async () => {
  const { adapter, turns } = await evidence(ids[0]);
  for (const invalid of [
    null,
    {},
    [],
    turns.slice(1),
    [...turns, turns[2]],
    [...turns].reverse(),
  ])
    expect(adapter.score(invalid as typeof turns).outcome).toBe('fail');
  for (const field of ['index', 'input', 'state', 'output', 'resultingState']) {
    const changed = structuredClone(turns);
    delete (changed[0] as unknown as Record<string, unknown>)[field];
    expect(adapter.score(changed).outcome).toBe('fail');
  }
  const oversized = structuredClone(turns);
  oversized[0].output.executionPlan[0].params = Object.fromEntries(
    Array.from({ length: 21 }, (_, index) => [`field${index}`, index]),
  );
  expect(
    weatherTransitionChainObservationSchema.safeParse(oversized).success,
  ).toBe(false);
  const changed = structuredClone(turns);
  changed[0].input.intent = 'Different request';
  expect(adapter.score(changed).outcome).toBe('fail');
  const { item } = documents(ids[0]);
  const other = documents(ids[1]);
  const swappedLineage = structuredClone(item);
  swappedLineage.definition.lineage = other.item.definition.lineage;
  expect(() => validateLoadedCase(swappedLineage)).toThrow();
  expect(() =>
    validateLoadedCase({
      ...item,
      definition: { ...item.definition, expectations: other.expected },
    }),
  ).toThrow();
  for (const bad of [
    { ...item.fixture.data, extra: true },
    { ...item.fixture.data, responses: [] },
  ])
    expect(() =>
      validateLoadedCase({ ...item, fixture: { ...item.fixture, data: bad } }),
    ).toThrow();
  expect(
    weatherTransitionChainExpectationsSchema.safeParse({
      ...item.definition.expectations,
      actions: [],
    }).success,
  ).toBe(false);
});

test('fixtures are not generated from expectations, and samples own their retained state', async () => {
  const { data, inputs, expected } = documents(ids[0]);
  data.responses[1].executionPlan = [];
  const broken = legacyWeatherTransitionChain(data, inputs, expected);
  const failed = await evaluateSample(identity, broken);
  expect(failed.evaluation).toBe('fail');
  expect(
    weatherTransitionChainObservationSchema.parse(failed.observation)[1].output
      .executionPlan,
  ).toEqual([]);
  const clean = documents(ids[0]);
  const adapter = legacyWeatherTransitionChain(
    clean.data,
    clean.inputs,
    clean.expected,
  );
  clean.data.responses[0].executionPlan = [];
  const first = await evaluateSample(identity, adapter);
  expect(first.evaluation).toBe('pass');
  const snapshot = structuredClone(first.observation);
  if (!first.observation) throw new Error('Missing first observation');
  first.observation[0].state.layout.instances[0].variant = 'changed';
  (first.records as unknown[]).length = 0;
  const second = await evaluateSample({ ...identity, sample: 2 }, adapter);
  expect(second.observation).toEqual(snapshot);
  expect(second.evaluation).toBe('pass');
});

test('D38 is separately scored as the complete stay-current branch, not option-offering semantics', async () => {
  const item = loadOfflineCases().find(
    (item) => item.definition.id === 'weather-current-noop-subset',
  );
  if (!item || item.definition.profile !== 'legacy-response-constraint')
    throw new Error('Missing D38');
  expect(item.definition.inputs.intent).toBe('Show current weather');
  expect(item.definition.lineage[0]).toMatchObject({
    pointer: '/items/37',
    taskId: 'cap-maelstrom-edge-deterministic-actions',
  });
  expect(item.definition.title).toContain('COMPLETE stay-current');
  expect(item.definition.purpose).toContain(
    'Option-offering and semantic interpretation are outside this predicate',
  );
  expect(item.definition.expectations.rule).toBe('no-op');
  expect((await evaluateSample(identity, caseAdapter(item))).evaluation).toBe(
    'pass',
  );
  for (const error of ['action', 'variant', 'missing', 'identity']) {
    const changed = structuredClone({ ...item, definition: item.definition });
    const response = changed.definition.inputs.response;
    if (error === 'action')
      response.executionPlan.push({
        instanceId: 'weather-main',
        action: 'showCurrent',
      });
    if (error === 'variant') response.instances[0].variant = 'weekly';
    if (error === 'missing') response.instances = [];
    if (error === 'identity') response.instances[0].instanceId = 'replacement';
    expect(
      (await evaluateSample(identity, caseAdapter(changed))).evaluation,
    ).toBe('fail');
  }
  const unrelated = structuredClone({ ...item, definition: item.definition });
  unrelated.definition.inputs.response.assistantText = 'Unrelated prose.';
  expect(
    (await evaluateSample(identity, caseAdapter(unrelated))).evaluation,
  ).toBe('pass');
});

test('incomplete chain execution remains unscored and never invokes the oracle', async () => {
  const { adapter, turns } = await evidence(ids[0]);
  const result = await evaluateSample(identity, {
    ...adapter,
    execute: async () => ({
      completeness: 'partial' as const,
      disposition: 'planned' as const,
      value: turns.slice(0, 2),
    }),
    score: () => {
      throw new Error('Incomplete evidence must not be scored');
    },
  });
  expect(result.evaluation).toBe('unscored');
  expect(result.completeness).toBe('partial');
  expect(result.error).toBeUndefined();
});
