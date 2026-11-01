import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type NoDualTargetPlanResponse,
  noDualTargetPlanDataSchema,
} from '../../packages/evals/src/adapters/legacy-no-dual-target-plan.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyNoDualTargetPlan,
  type NoDualTargetPlanTurn,
} from './no-dual-target-plan-fixture.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in no-dual-target-plan controls');
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
const identity = {
  runId: 'no-dual-target-plan-controls',
  caseId: 'no-dual-target-plan',
  runtimeId: 'scripted',
  sample: 1,
};
function fixture() {
  const item = loadOfflineCases().find(
    (item) => item.definition.id === 'no-dual-target-plan',
  );
  if (!item || item.definition.profile !== 'legacy-no-dual-target-plan')
    throw new Error('Missing D17 case');
  return {
    definition: item.definition,
    data: noDualTargetPlanDataSchema.parse(item.fixture.data),
  };
}
function adapter() {
  const { definition, data } = fixture();
  return legacyNoDualTargetPlan(
    data,
    definition.inputs,
    definition.expectations,
  );
}
async function rescore(change: (turn: NoDualTargetPlanTurn) => void) {
  const subject = adapter();
  const positive = await evaluateSample(identity, subject);
  expect(positive.evaluation).toBe('pass');
  if (!positive.observation) throw new Error('Missing response evidence');
  const turns = structuredClone(positive.observation);
  change(turns[0]);
  return evaluateSample(identity, {
    ...subject,
    execute: async () => ({
      completeness: 'complete',
      disposition: 'planned',
      value: turns,
    }),
  });
}
const weather = 'weather-main';
const calendar = 'calendar-main';
const other = 'unrelated-main';
function actions(targets: string[]): NoDualTargetPlanResponse['executionPlan'] {
  return targets.map((instanceId) => ({
    instanceId,
    action: 'notARegisteredAction',
    params: { arbitrary: [{ nested: [true, null, 123, 'weekly'] }] },
  }));
}

test('D17 pins exact source identity, prompt and context without adding semantic clarification claims', () => {
  const { definition, data } = fixture();
  expect(definition).toMatchObject({
    inputs: { intent: 'Switch to the weekly view' },
    expectations: { rule: 'no-dual-target-plan' },
    synthetic: true,
    migration: 'legacy-derived-harness',
    review: 'pending-human-review',
    lineage: [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        taskId: 'cap-maelstrom-conv-clarification',
        datasetId: 'cap-maelstrom-conv-clarification',
        pointer: '/items/16',
      },
    ],
  });
  expect(definition.title).toContain('COMPLETE D17');
  expect(definition.purpose).toContain(
    'Semantic clarification and whole-response safety are outside this predicate',
  );
  expect(data.initial).toEqual({
    instances: [
      { instanceId: weather, vesselId: 'weather', variant: 'current' },
      { instanceId: calendar, vesselId: 'calendar', variant: 'month' },
    ],
  });
  expect(data.response).toEqual({
    assistantText: 'I like trains.',
    executionPlan: [],
  });
});

test('D17 empty, single/repeated protected-target and unrelated/mixed Execution Plans pass regardless of text or Action validity', async () => {
  for (const targets of [
    [],
    [weather],
    [calendar],
    [weather, weather],
    [calendar, calendar],
    [other],
    [other, other],
    [weather, other],
    [other, calendar],
    [other, weather, other, weather],
    [calendar, other, calendar],
  ]) {
    for (const assistantText of [
      '',
      '   ',
      'I like trains.',
      'Which weekly view?',
      'Clarification requested.',
    ]) {
      const result = await rescore((turn) => {
        turn.output.executionPlan = actions(targets);
        turn.output.assistantText = assistantText;
      });
      expect(result.evaluation).toBe('pass');
    }
  }
});

test('D17 any complete Execution Plan containing both protected IDs fails; question or clarification text cannot rescue it', async () => {
  for (const targets of [
    [weather, calendar],
    [calendar, weather],
    [weather, other, calendar],
    [calendar, other, weather],
    [weather, weather, calendar, calendar],
    [other, calendar, other, calendar, weather, other, weather],
    [...Array<string>(19).fill(weather), calendar],
    [...Array<string>(19).fill(calendar), weather],
  ]) {
    for (const assistantText of [
      'Which view?',
      'Could you clarify whether you mean Weather or Calendar?',
      'I like trains.',
      '',
    ]) {
      const result = await rescore((turn) => {
        turn.output.executionPlan = actions(targets);
        turn.output.assistantText = assistantText;
      });
      expect(result.execution).toBe('completed');
      expect(result.evaluation).toBe('fail');
      expect(result.failures).toEqual([
        'Execution Plan contains both weather-main and calendar-main',
      ]);
    }
  }
});

test('D17 response evidence is required and bounded, never defaulted to an empty Execution Plan', async () => {
  for (const output of [
    undefined,
    null,
    {},
    { assistantText: 'Which view?' },
    { executionPlan: [] },
    { assistantText: null, executionPlan: [] },
    { assistantText: '', executionPlan: null },
    { assistantText: '', executionPlan: {} },
    { assistantText: '', executionPlan: [null] },
    { assistantText: '', executionPlan: [{ action: 'showWeekly' }] },
    { assistantText: '', executionPlan: [{ instanceId: weather }] },
    {
      assistantText: '',
      executionPlan: actions(Array<string>(21).fill(weather)),
    },
    { assistantText: 'x'.repeat(2001), executionPlan: [] },
    {
      assistantText: '',
      executionPlan: [
        {
          instanceId: weather,
          action: 'any',
          params: { tooLong: 'x'.repeat(1001) },
        },
      ],
    },
  ]) {
    const result = await rescore((turn) => {
      Object.assign(turn, { output });
    });
    expect(result.evaluation, JSON.stringify(output)).toBe('fail');
    expect(result.error).toBeUndefined();
  }
  const subject = adapter();
  for (const turns of [null, undefined, [], [{}]])
    expect(subject.score(turns as never).outcome).toBe('fail');
  const complete = await evaluateSample(identity, subject);
  if (!complete.observation) throw new Error('Missing control');
  expect(
    subject.score([...complete.observation, ...complete.observation]).outcome,
  ).toBe('fail');
  for (const completeness of ['partial', 'absent'] as const) {
    const result = await evaluateSample(identity, {
      ...subject,
      execute: async () => ({
        completeness,
        disposition: 'planned',
        value: complete.observation ?? [],
      }),
      score: () => {
        throw new Error('Incomplete evidence must not be scored');
      },
    });
    expect(result.evaluation).toBe('unscored');
    expect(result.error).toBeUndefined();
  }
});

test('D17 scripts are independent, reset per sample and never certify state or text semantics', async () => {
  const { definition, data } = fixture();
  data.response.executionPlan = actions([weather, calendar]);
  const subject = legacyNoDualTargetPlan(
    data,
    definition.inputs,
    definition.expectations,
  );
  const first = await evaluateSample(identity, subject);
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(first.evaluation).toBe('fail');
  expect(first.observation?.[0].output).toEqual(data.response);
  expect(second.observation).toEqual(first.observation);
  const changedSnapshots = await rescore((turn) => {
    turn.state.instances = [];
    turn.resultingState.instances = [
      { instanceId: other, vesselId: 'anything', variant: 'anything' },
    ];
  });
  expect(changedSnapshots.evaluation).toBe('pass');
  const changedPrompt = await rescore((turn) => {
    turn.input.intent = 'different';
  });
  expect(changedPrompt.evaluation).toBe('fail');
});
