import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  assistantTextDataSchema,
  assistantTextExpectationsSchema,
  assistantTextInputsSchema,
} from '../../packages/evals/src/adapters/legacy-assistant-text.js';
import { parseOfflineCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  legacyAssistantText,
  scoreAssistantText,
} from './assistant-text-fixture.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in assistant-text controls');
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
function documents(id = 'assistant-exact-text') {
  const item = loadOfflineCases().find((item) => item.definition.id === id);
  if (!item || item.definition.profile !== 'legacy-assistant-text')
    throw new Error('Missing assistant-text case');
  return {
    item,
    data: assistantTextDataSchema.parse(item.fixture.data),
    inputs: structuredClone(item.definition.inputs),
    expected: structuredClone(item.definition.expectations),
  };
}
const identity = {
  runId: 'assistant-text-controls',
  caseId: 'assistant-text',
  runtimeId: 'scripted',
  sample: 1,
};
async function evidence(id?: string) {
  const { data, inputs, expected } = documents(id);
  const subject = legacyAssistantText(data, inputs, expected);
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

test('D03/T01 and COMPLETE D14/T19 retain exact lineage and distinct independent fixtures', async () => {
  for (const [id, pointer, taskId, intent] of [
    [
      'assistant-exact-text',
      '/items/2',
      'cap-ai-chat-single-message',
      'Reply with exactly: HELLO_MAELSTROM',
    ],
    [
      'assistant-non-json-subset',
      '/items/13',
      'cap-maelstrom-structured-view-model-validity',
      'Return only JSON with title, summary, records, series, and actions. Use at least one record and one action. Keep series points sorted by x when present.',
    ],
  ]) {
    const { item, inputs } = documents(id);
    expect(item.definition).toMatchObject({
      synthetic: true,
      migration: 'legacy-derived-harness',
      review: 'pending-human-review',
      lineage: [
        {
          source: 'legacy',
          revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
          path: 'langfuse/maelstrom-eval-dataset.v1.json',
          taskId,
          datasetId: taskId,
          pointer,
        },
      ],
    });
    expect(inputs.intent).toBe(intent);
    const result = await evaluateSample(identity, caseAdapter(item));
    expect(result.evaluation).toBe('pass');
    expect(result.provenance).toContain('synthetic');
  }
  expect(documents().item.definition.fixtureId).not.toBe(
    documents('assistant-non-json-subset').item.definition.fixtureId,
  );
  const d03 = documents();
  expect(d03.expected).toEqual({
    rule: 'exact-text',
    exactText: 'HELLO_MAELSTROM',
  });
  expect(d03.item.definition.purpose).toContain(
    'no shared-ai.chat, streaming or runtime compatibility claim',
  );
});

test('D03 source exact-text normalization allows whitespace but not case, punctuation, extra prose or empty text', async () => {
  const { subject, turns } = await evidence();
  for (const text of ['HELLO_MAELSTROM', ' \t\nHELLO_MAELSTROM\r\n ']) {
    turns[0].output.assistantText = text;
    expect(subject.score(turns).outcome).toBe('pass');
  }
  for (const text of [
    'hello_maelstrom',
    'HELLO_MAELSTROM!',
    'HELLO_MAELSTROM extra prose',
    '',
    ' \n\t ',
  ]) {
    turns[0].output.assistantText = text;
    expect(subject.score(turns).outcome).toBe('fail');
  }
  const { inputs } = documents();
  turns[0].output.assistantText = '  Hello\n\tMaelstrom  ';
  expect(
    scoreAssistantText(turns, inputs, {
      rule: 'exact-text',
      exactText: 'Hello Maelstrom',
    }).outcome,
  ).toBe('pass');
});

test('D14 source isJsonObjectLike rejects objects and arrays, not primitives, null, malformed or fenced JSON', async () => {
  const { subject, turns } = await evidence('assistant-non-json-subset');
  for (const text of [
    '{}',
    ' {"title":"UI"} ',
    '[]',
    '[1, null]',
    '',
    ' \n\t ',
  ]) {
    turns[0].output.assistantText = text;
    expect(subject.score(turns).outcome).toBe('fail');
  }
  for (const text of [
    'I like trains.',
    'The sky is blue.',
    '"hello"',
    '""',
    '42',
    '0',
    'true',
    'false',
    'null',
    '{broken',
    '[',
    '```json\n{}\n```',
  ]) {
    turns[0].output.assistantText = text;
    expect(subject.score(turns).outcome).toBe('pass');
  }
});

test('D14 completion is limited to source text predicates, not semantic refusal or redirection', async () => {
  const { item, data, expected } = documents('assistant-non-json-subset');
  expect(item.definition.title).toContain('COMPLETE D14');
  expect(item.definition.purpose).toContain(
    'Semantic refusal and Vessel-orchestration redirection are outside this predicate',
  );
  expect(expected).toEqual({
    rule: 'nonempty-not-json-container',
    coverage: 'COMPLETE',
  });
  expect(data.response.assistantText).toBe('I like trains.');
  const { subject } = await evidence('assistant-non-json-subset');
  expect(subject.provenance).toContain('COMPLETE D14');
  expect(subject.provenance).toContain('outside this predicate');
  expect(subject.provenance).toContain('no semantic success');
  for (const change of [
    { coverage: 'PARTIAL' },
    { requiredUnresolved: [] },
    { coverage: undefined },
  ])
    expect(
      assistantTextExpectationsSchema.safeParse({ ...expected, ...change })
        .success,
    ).toBe(false);
});

test('assistant-text missing/malformed/extra evidence and wrong prompt or sequence fail closed', async () => {
  for (const id of ['assistant-exact-text', 'assistant-non-json-subset']) {
    const { turns, inputs, expected } = await evidence(id);
    const turn = turns[0];
    for (const invalid of [
      undefined,
      null,
      [],
      [turn, turn],
      [{}],
      [{ ...turn, output: {} }],
      [{ ...turn, output: { assistantText: null } }],
      [{ ...turn, output: { assistantText: 42 } }],
      [{ ...turn, output: { assistantText: 'x'.repeat(2001) } }],
      [{ ...turn, output: { ...turn.output, error: 'engine failure' } }],
      [{ ...turn, state: undefined }],
      [{ ...turn, resultingState: undefined }],
      [{ ...turn, index: 1 }],
      [{ ...turn, input: { intent: 'changed prompt' } }],
    ])
      expect(scoreAssistantText(invalid, inputs, expected).outcome).toBe(
        'fail',
      );
    for (const invalid of [
      {},
      { response: {} },
      { response: { assistantText: false } },
      { response: { ...turn.output, extra: true } },
    ])
      expect(assistantTextDataSchema.safeParse(invalid).success).toBe(false);
    const { item } = documents(id);
    expect(() =>
      parseOfflineCase({ ...item.definition, lineage: [] }),
    ).toThrow();
    expect(() =>
      parseOfflineCase({ ...item.definition, expectations: {} }),
    ).toThrow();
    expect(() =>
      caseAdapter({ ...item, fixture: { ...item.fixture, data: {} } }),
    ).toThrow();
    expect(() =>
      caseAdapter({ ...item, fixture: { ...item.fixture, kind: 'wrong' } }),
    ).toThrow();
  }
  expect(assistantTextInputsSchema.safeParse({ intent: '' }).success).toBe(
    false,
  );
});

test('changing expectations or requests never generates the synthetic candidate; samples reset', async () => {
  const { data, inputs, expected } = documents();
  const baseline = await evaluateSample(
    identity,
    legacyAssistantText(data, inputs, expected),
  );
  const changed = await evaluateSample(
    identity,
    legacyAssistantText(data, inputs, {
      rule: 'exact-text',
      exactText: 'DIFFERENT',
    }),
  );
  expect(changed.evaluation).toBe('fail');
  expect(changed.observation).toEqual(baseline.observation);
  const subject = legacyAssistantText(
    data,
    { intent: 'A different request' },
    expected,
  );
  const first = await evaluateSample(identity, subject);
  expect(first.observation?.[0].output).toEqual(data.response);
  if (!first.observation) throw new Error('Missing observation');
  first.observation[0].output.assistantText = 'mutated';
  const second = await evaluateSample({ ...identity, sample: 2 }, subject);
  expect(second.observation?.[0].output).toEqual(data.response);
});
