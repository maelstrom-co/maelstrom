import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  assistantIdentityDataSchema,
  assistantIdentityExpectationsSchema,
  assistantIdentityInputsSchema,
} from '../../packages/evals/src/adapters/legacy-assistant-identity.js';
import { parseOfflineCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  legacyAssistantIdentity,
  scoreAssistantIdentity,
} from './assistant-identity-fixture.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in assistant-identity controls');
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
    (item) => item.definition.id === 'assistant-identity-subset',
  );
  if (!item || item.definition.profile !== 'legacy-assistant-identity')
    throw new Error('Missing assistant-identity case');
  return {
    item,
    data: assistantIdentityDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
const identity = {
  runId: 'assistant-identity-controls',
  caseId: 'assistant-identity-subset',
  runtimeId: 'scripted',
  sample: 1,
};
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = legacyAssistantIdentity(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observation');
  return {
    subject,
    turns: structuredClone([...result.observation]),
    inputs,
    expected,
  };
}

test('COMPLETE D02/T24 retains dataset prompts, lineage, independent expectations and declared scope', async () => {
  const { item, inputs, expected } = documents();
  expect(item.definition).toMatchObject({
    synthetic: true,
    migration: 'legacy-derived-harness',
    review: 'pending-human-review',
    lineage: [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        pointer: '/items/1',
        taskId: 'reg-maelstrom-multiturn-assistant-identity-consistency',
        datasetId: 'reg-maelstrom-multiturn-assistant-identity-consistency',
      },
    ],
  });
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    'Before we begin, who are you? Answer with your assistant identity.',
    'A few turns later, who are you again? Keep the same assistant identity.',
    'Final check: identify yourself again and do not use the framework name.',
  ]);
  expect(expected).toEqual({
    requiredIdentity: 'MAR',
    forbiddenIdentity: 'Maelstrom',
    expectedTurns: 3,
    requireNonemptyText: true,
    executionPlanLength: 0,
    layoutType: 'tiling',
    layoutInstanceCount: 0,
    coverage: 'COMPLETE',
  });
  expect(item.definition.title).toContain('COMPLETE D02');
  expect(item.definition.purpose).toContain(
    'does not establish semantic identity persistence',
  );
  const result = await evaluateSample(identity, caseAdapter(item));
  expect(result.evaluation).toBe('pass');
  expect(result.observation).toHaveLength(3);
  expect(result.provenance).toContain('synthetic COMPLETE D02');
  expect(result.provenance).toContain(
    'no model, prompt effectiveness, provider or runtime compatibility claim',
  );
  for (const change of [
    { coverage: 'PARTIAL' },
    { requiredUnresolved: [] },
    { expectedTurns: 0 },
    { executionPlanLength: 1 },
    { extra: true },
  ])
    expect(
      assistantIdentityExpectationsSchema.safeParse({ ...expected, ...change })
        .success,
    ).toBe(false);
});

test('D02 checks every turn for nonblank text, MAR substring and Maelstrom exclusion without claiming semantic identity', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const text of [
      '',
      ' \n\t ',
      'I am another assistant.',
      'MAELSTROM',
      'MAR, not mAeLsTrOm.',
      'M A R',
    ]) {
      const changed = structuredClone(turns);
      changed[index].output.assistantText = text;
      expect(subject.score(changed).outcome).toBe('fail');
    }
    for (const text of [
      'mar',
      'I am mAr.',
      ' \nMAR\t ',
      'The market is open.',
      'I am not MAR.',
    ]) {
      const changed = structuredClone(turns);
      changed[index].output.assistantText = text;
      expect(subject.score(changed).outcome).toBe('pass');
    }
  }
});

test('D02 empty Execution Plan, tiling type and zero layout Instances are required independently on every turn', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const mutation of ['action', 'grid', 'instance']) {
      const changed = structuredClone(turns);
      const output = changed[index].output;
      if (mutation === 'action')
        output.executionPlan.push({
          instanceId: 'weather-main',
          action: 'showWeekly',
        });
      if (mutation === 'grid') output.layout.type = 'grid';
      if (mutation === 'instance')
        output.layout.instances.push({
          instanceId: 'weather-main',
          vesselId: 'weather',
          variant: 'current',
        });
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
});

test('D02 missing, malformed, extra or reordered turns fail closed', async () => {
  const { turns, inputs, expected } = await evidence();
  const score = (value: unknown) =>
    scoreAssistantIdentity(value, inputs, expected).outcome;
  for (const invalid of [
    undefined,
    null,
    [],
    turns.slice(1),
    [...turns, turns[0]],
    [...turns].reverse(),
  ])
    expect(score(invalid)).toBe('fail');
  for (let index = 0; index < 3; index++) {
    const turn = turns[index];
    for (const invalid of [
      undefined,
      {},
      { ...turn, output: undefined },
      { ...turn, output: {} },
      ...[null, 42, 'x'.repeat(2001)].map((assistantText) => ({
        ...turn,
        output: { ...turn.output, assistantText },
      })),
      { ...turn, output: { ...turn.output, executionPlan: undefined } },
      { ...turn, output: { ...turn.output, executionPlan: [null] } },
      { ...turn, output: { ...turn.output, layout: undefined } },
      { ...turn, output: { ...turn.output, layout: { type: 'tiling' } } },
      {
        ...turn,
        output: {
          ...turn.output,
          layout: { type: 'tiling', instances: [null] },
        },
      },
      { ...turn, output: { ...turn.output, error: 'engine error' } },
      { ...turn, state: undefined },
      { ...turn, resultingState: undefined },
      { ...turn, index: 3 },
      { ...turn, index: (index + 1) % 3 },
      { ...turn, input: { intent: 'Changed request' } },
    ]) {
      const changed: unknown[] = [...turns];
      changed[index] = invalid;
      expect(score(changed)).toBe('fail');
    }
  }
});

test('D02 strict fixture and profile boundaries reject malformed or substituted contracts', () => {
  const { item, data, inputs } = documents();
  for (const invalid of [
    {},
    { responses: [] },
    { responses: [...data.responses, data.responses[0]] },
    { ...data, expectations: {} },
    { responses: [{}, ...data.responses.slice(1)] },
  ])
    expect(assistantIdentityDataSchema.safeParse(invalid).success).toBe(false);
  expect(
    assistantIdentityInputsSchema.safeParse({ turns: inputs.turns.slice(1) })
      .success,
  ).toBe(false);
  for (const change of [
    { lineage: [] },
    { expectations: {} },
    { profile: 'unknown-identity' },
  ])
    expect(() => parseOfflineCase({ ...item.definition, ...change })).toThrow();
  for (const change of [{ data: {} }, { kind: 'wrong' }])
    expect(() =>
      caseAdapter({ ...item, fixture: { ...item.fixture, ...change } }),
    ).toThrow();
});

test('D02 prompts and expectations never generate response text; scripts reset between samples', async () => {
  const { data, inputs, expected } = documents();
  const baseline = await evaluateSample(
    identity,
    legacyAssistantIdentity(data, inputs, expected),
  );
  for (const change of [
    { requiredIdentity: 'DIFFERENT' },
    { forbiddenIdentity: 'MAR' },
  ]) {
    const changed = await evaluateSample(
      identity,
      legacyAssistantIdentity(data, inputs, { ...expected, ...change }),
    );
    expect(changed.evaluation).toBe('fail');
    expect(changed.observation).toEqual(baseline.observation);
  }
  const changedInputs = {
    turns: inputs.turns.map(() => ({
      intent: 'Identify as DIFFERENT instead.',
    })),
  };
  const subject = legacyAssistantIdentity(data, changedInputs, expected);
  const first = await evaluateSample(identity, subject);
  expect(first.evaluation).toBe('pass');
  expect(first.observation?.map((turn) => turn.output)).toEqual(data.responses);
  if (!first.observation) throw new Error('Missing observation');
  first.observation[0].output.assistantText = 'mutated';
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation?.map((turn) => turn.output)).toEqual(
    data.responses,
  );
  const changedScript = structuredClone(data);
  changedScript.responses[1].assistantText = 'DIFFERENT';
  expect(
    (
      await evaluateSample(
        identity,
        legacyAssistantIdentity(changedScript, inputs, expected),
      )
    ).evaluation,
  ).toBe('fail');
});
