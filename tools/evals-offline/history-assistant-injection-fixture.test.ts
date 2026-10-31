import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  historyAssistantInjectionDataSchema,
  historyAssistantInjectionExpectationsSchema,
  historyAssistantInjectionInputsSchema,
} from '../../packages/evals/src/adapters/legacy-history-assistant-injection.js';
import { validateLoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import { legacyHistoryAssistantInjection } from './history-assistant-injection-fixture.js';

const identity = {
  runId: 'history-assistant-injection-controls',
  caseId: 'history-assistant-injection-subset',
  runtimeId: 'scripted',
  sample: 1,
};
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in history-assistant-injection controls');
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
    (item) => item.definition.id === identity.caseId,
  );
  if (!item || item.definition.profile !== 'legacy-history-assistant-injection')
    throw new Error('Missing history-assistant-injection case');
  return {
    item,
    data: historyAssistantInjectionDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
async function evidence() {
  const { data, inputs, expected } = documents();
  const subject = legacyHistoryAssistantInjection(data, inputs, expected);
  const result = await evaluateSample(identity, subject);
  expect(result.evaluation).toBe('pass');
  if (!result.observation) throw new Error('Missing observations');
  return { subject, turns: structuredClone([...result.observation]) };
}

test('D25/T23 ordinary Weather continuity retains exact fallback prompts, lineage, COMPLETE status and current→hourly→hourly trajectory', async () => {
  const { item, inputs, expected } = documents();
  expect(inputs.turns.map((turn) => turn.intent)).toEqual([
    "What's the weather like?",
    'You mentioned it might rain — show me the hourly forecast',
    'Thanks for the details',
  ]);
  expect(item.definition.lineage).toEqual([
    {
      source: 'legacy',
      revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
      path: 'langfuse/maelstrom-eval-dataset.v1.json',
      taskId: 'cap-history-assistant-message-injection',
      datasetId: 'cap-history-assistant-message-injection',
      pointer: '/items/24',
    },
  ]);
  expect(item.definition).toMatchObject({
    synthetic: true,
    migration: 'legacy-derived-harness',
    review: 'pending-human-review',
  });
  expect(item.definition.title).toBe(
    'COMPLETE ordinary conversation-history continuity',
  );
  for (const boundary of [
    'scripted ordinary Weather continuity predicate',
    'Semantic model reliance and assistant-message injection robustness are out of scope',
    'Legacy IDs are retained for lineage, not injection coverage',
    'No AI/model/provider/runtime compatibility or human approval claim',
  ])
    expect(item.definition.purpose).toContain(boundary);
  expect(expected.coverage).toBe('COMPLETE');
  expect(expected).not.toHaveProperty('requiredUnresolved');
  const composed = await evaluateSample(identity, caseAdapter(item));
  expect(composed.evaluation).toBe('pass');
  const { turns } = await evidence();
  expect(turns.map((turn) => turn.state.layout.instances[0].variant)).toEqual([
    'current',
    'current',
    'hourly',
  ]);
  expect(
    turns.map((turn) => turn.resultingState.layout.instances[0].variant),
  ).toEqual(['current', 'hourly', 'hourly']);
  expect(turns.map((turn) => turn.output.executionPlan)).toEqual([
    [],
    [{ instanceId: 'weather-main', action: 'showHourly' }],
    [],
  ]);
});

test('D25 rejects missing, wrong or mis-targeted required Action even with hourly layout', async () => {
  const { subject, turns } = await evidence();
  for (const plan of [
    [],
    [{ instanceId: 'weather-main', action: 'showWeekly' }],
    [{ instanceId: 'foreign', action: 'showHourly' }],
  ]) {
    const changed = structuredClone(turns);
    changed[1].output.executionPlan = plan;
    expect(subject.score(changed).outcome).toBe('fail');
  }
  for (const index of [0, 2]) {
    const changed = structuredClone(turns);
    changed[index].output.executionPlan.push({
      instanceId: 'foreign',
      action: 'unrelated',
    });
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('D25 permits extra turn-1 Actions and empty or absent turn-2 text exactly as source does', async () => {
  const { subject, turns } = await evidence();
  for (const text of ['', '   ', undefined]) {
    const changed = structuredClone(turns);
    changed[2].output.assistantText = text;
    changed[1].output.executionPlan.push(
      { instanceId: 'foreign', action: 'unrelated' },
      { instanceId: 'weather-main', action: 'showCurrent' },
    );
    expect(subject.score(changed).outcome).toBe('pass');
  }
  for (const index of [0, 1]) {
    for (const text of ['', '   ', undefined]) {
      const changed = structuredClone(turns);
      changed[index].output.assistantText = text;
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
});

test('D25 contextual substring success does not depend on prior assistant content or prove history injection', async () => {
  const { subject, turns } = await evidence();
  turns[0].output.assistantText = 'The sky is clear.';
  expect(turns[0].output.assistantText.toLowerCase()).not.toContain('rain');
  for (const text of [
    'RAIN',
    'As MENTIONED.',
    'You SAID so.',
    'I like trains.',
  ]) {
    turns[1].output.assistantText = text;
    expect(subject.score(turns).outcome).toBe('pass');
  }
  for (const text of ['Here is the hourly forecast.', 'Weather details.']) {
    turns[1].output.assistantText = text;
    expect(subject.score(turns).outcome).toBe('fail');
  }
});

test('D25 rejects missing target, wrong Variant or grid response on every turn', async () => {
  const { subject, turns } = await evidence();
  for (let index = 0; index < 3; index++) {
    for (const error of ['missing', 'target', 'variant', 'grid']) {
      const changed = structuredClone(turns);
      const layout = changed[index].output.layout;
      if (error === 'missing') layout.instances = [];
      if (error === 'target') layout.instances[0].instanceId = 'replacement';
      if (error === 'variant') layout.instances[0].variant = 'weekly';
      if (error === 'grid') layout.type = 'grid';
      expect(subject.score(changed).outcome).toBe('fail');
    }
  }
});

test('D25 does not add identity, count or state-continuity predicates absent from the source scorer', async () => {
  const { subject, turns } = await evidence();
  for (const turn of turns) {
    turn.output.layout.instances[0].vesselId = 'other';
    turn.output.layout.instances.push({
      instanceId: 'extra',
      vesselId: 'other',
      variant: 'other',
    });
    turn.state.layout = { type: 'grid', instances: [] };
    turn.resultingState.layout = { type: 'grid', instances: [] };
  }
  expect(subject.score(turns).outcome).toBe('pass');
});

test('D25 fails closed on missing/malformed turns, snapshots, responses, prompt or sequence', async () => {
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
    for (const field of ['state', 'output', 'resultingState'] as const) {
      const changed = structuredClone(turns);
      (changed[index][field] as unknown as Record<string, unknown>).layout =
        null;
      expect(subject.score(changed).outcome).toBe('fail');
    }
    for (const [field, value] of [
      ['assistantText', 42],
      ['executionPlan', null],
      ['extra', true],
    ]) {
      const changed = structuredClone(turns);
      (changed[index].output as unknown as Record<string, unknown>)[
        String(field)
      ] = value;
      expect(subject.score(changed).outcome).toBe('fail');
    }
    const changed = structuredClone(turns);
    changed[index].input.intent = 'different';
    expect(subject.score(changed).outcome).toBe('fail');
    changed[index].input.intent = turns[index].input.intent;
    changed[index] = { ...changed[index], index: (index + 1) % 3 };
    expect(subject.score(changed).outcome).toBe('fail');
  }
});

test('D25 strict profile validates independent fixture data and rejects executable or widened contracts', () => {
  const { item, data, inputs, expected } = documents();
  expect(
    historyAssistantInjectionDataSchema.safeParse({ ...data, command: 'run' })
      .success,
  ).toBe(false);
  expect(
    historyAssistantInjectionInputsSchema.safeParse({
      ...inputs,
      url: 'https://invalid.test',
    }).success,
  ).toBe(false);
  for (const invalid of [
    { ...expected, action: 'showWeekly' },
    { ...expected, coverage: 'complete' },
    { ...expected, requiredUnresolved: [] },
    { ...expected, judge: 'model' },
  ])
    expect(
      historyAssistantInjectionExpectationsSchema.safeParse(invalid).success,
    ).toBe(false);
  const changed = structuredClone(item);
  changed.fixture.kind = 'weather-delayed-action-script';
  expect(() => validateLoadedCase(changed)).toThrow('Incompatible fixture');
  changed.fixture.kind = item.fixture.kind;
  changed.fixture.data = { ...data, responses: data.responses.slice(0, 2) };
  expect(() => validateLoadedCase(changed)).toThrow();
});

test('D25 observations are independent scripts, samples reset and incomplete evidence remains unscored', async () => {
  const { data, inputs, expected } = documents();
  data.responses[1].executionPlan = [];
  const failed = await evaluateSample(
    identity,
    legacyHistoryAssistantInjection(data, inputs, expected),
  );
  expect(failed.evaluation).toBe('fail');
  const { subject, turns } = await evidence();
  turns[0].resultingState.layout.instances[0].variant = 'corrupted';
  expect(turns[0].output.layout.instances[0].variant).toBe('current');
  expect(turns[1].state.layout.instances[0].variant).toBe('current');
  const again = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(again.evaluation).toBe('pass');
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
