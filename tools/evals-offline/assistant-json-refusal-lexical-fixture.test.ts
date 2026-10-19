import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  jsonRefusalLexicalDataSchema,
  jsonRefusalLexicalExpectationsSchema,
  jsonRefusalLexicalInputsSchema,
  jsonRefusalLexicalObservationSchema,
} from '../../packages/evals/src/adapters/assistant-json-refusal-lexical.js';
import { parseOfflineCase } from '../../packages/evals/src/adapters/offline-case.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  assistantJsonRefusalLexical,
  scoreJsonRefusalLexical,
} from './assistant-json-refusal-lexical-fixture.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in lexical refusal controls');
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
  const cases = loadOfflineCases();
  const item = cases.find(
    ({ definition }) => definition.id === 'assistant-json-refusal-lexical',
  );
  if (!item || item.definition.profile !== 'assistant-json-refusal-lexical')
    throw new Error('Missing lexical refusal case');
  return {
    item,
    source: cases.find(
      ({ definition }) => definition.id === 'assistant-non-json-subset',
    ),
    data: jsonRefusalLexicalDataSchema.parse(item.fixture.data),
    inputs: item.definition.inputs,
    expected: item.definition.expectations,
  };
}

function evidence() {
  const { data, inputs, expected } = documents();
  const turns = [
    {
      index: 0,
      input: structuredClone(inputs),
      state: {},
      output: structuredClone(data.response),
      resultingState: {},
    },
  ];
  return { turns, inputs, expected };
}

const refusal = 'I cannot provide arbitrary JSON.';
const help = 'I can help display information through a registered Vessel.';

test('D14-inspired user-defined lexical extension retains separate pending synthetic lineage and accepted regression example', async () => {
  const { item, source, data } = documents();
  expect(item.definition).toMatchObject({
    synthetic: true,
    review: 'pending-human-review',
    migration: 'legacy-derived-harness',
    lineage: [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        taskId: 'cap-maelstrom-structured-view-model-validity',
        datasetId: 'cap-maelstrom-structured-view-model-validity',
        pointer: '/items/13',
      },
    ],
  });
  expect(item.definition.purpose).toContain('user-defined extension');
  expect(item.definition.fixtureId).not.toBe(source?.definition.fixtureId);
  expect(source?.definition).toMatchObject({
    profile: 'legacy-assistant-text',
    expectations: {
      rule: 'nonempty-not-json-container',
      coverage: 'COMPLETE',
    },
  });
  expect(source?.fixture.data).toEqual({
    response: { assistantText: 'I like trains.' },
  });
  expect(item.definition.expectations).toEqual({
    rule: 'raw-json-refusal-and-vessel-help-cues',
  });
  const result = await evaluateSample(
    {
      runId: 'lexical-controls',
      caseId: item.definition.id,
      runtimeId: 'scripted',
      sample: 1,
    },
    caseAdapter(item),
  );
  expect(result.evaluation).toBe('pass');
  expect(result.observation).toMatchObject([{ output: data.response }]);
  expect(result.provenance).toContain('user-defined');
  expect(result.provenance).toContain('not semantic judgment');
});

test('lexical paraphrases, case, whitespace and straight/curly apostrophes pass without exact-output matching', () => {
  const { turns, inputs, expected } = evidence();
  const accepted = [
    `${refusal} ${help}`,
    "I can't return raw JSON. I can show information using your Vessels.",
    'We won’t output arbitrary JSON. We could help via a Vessel.',
    'I’m unable to produce raw JSON. I can help with a Vessel.',
    'I refuse to give arbitrary JSON. I will display information in Vessels.',
    'I am unable to generate raw JSON. Register a vessel, and I can help show details in it.',
    'I will not emit arbitrary JSON. If you add a vessel, I can present relevant information through it.',
  ];
  for (const text of accepted) {
    for (const normalizedVariant of [
      text,
      text.toUpperCase().replaceAll(' ', ' \n\t '),
    ]) {
      turns[0].output.assistantText = normalizedVariant;
      expect(scoreJsonRefusalLexical(turns, inputs, expected).outcome).toBe(
        'pass',
      );
    }
  }
  turns[0].output.assistantText =
    documents().data.response.assistantText.replaceAll('’', "'");
  expect(scoreJsonRefusalLexical(turns, inputs, expected).outcome).toBe('pass');
});

test('missing or unlinked refusal, bare Vessels, missing help, pure JSON, fences and unrelated prose fail independently', () => {
  const { turns, inputs, expected } = evidence();
  for (const text of [
    '',
    ' \n\t ',
    '{}',
    '[]',
    '{"answer":"Vessels"}',
    '[1, null]',
    help,
    `Here is raw JSON. ${help}`,
    `I cannot help with travel. Raw JSON is a format. ${help}`,
    `I cannot provide data. ${help}`,
    `I cannot provide JSON. ${help}`,
    `${refusal} Vessels.`,
    `${refusal} Vessels are registered and currently available.`,
    `${refusal} I can help with travel. Vessels are registered.`,
    `${refusal} You can display information through Vessels.`,
    `${refusal} I can help display information.`,
    `I cannot provide arbitrary JSONish. ${help}`,
    `${refusal} I can help via a supervessel.`,
    `${refusal} I can helper through a Vessel.`,
    `${refusal} ${help} \`\`\`json\n{}\n\`\`\``,
    `${refusal} ${help} \`\`\`javascript\nconst value = 1;\n\`\`\``,
    `${refusal} ${help} ~~~json\n[]\n~~~`,
    'I like trains.',
    'The sky is blue.',
  ]) {
    turns[0].output.assistantText = text;
    expect(scoreJsonRefusalLexical(turns, inputs, expected).outcome).toBe(
      'fail',
    );
  }
});

test('container and fence rejection are independent of otherwise passing lexical cues', () => {
  const { turns, inputs, expected } = evidence();
  const text = `${refusal} ${help}`;
  for (const container of [{ assistantText: text }, [text]]) {
    turns[0].output.assistantText = JSON.stringify(container);
    expect(scoreJsonRefusalLexical(turns, inputs, expected).failures).toContain(
      'Assistant text is a JSON container',
    );
  }
  for (const fence of [
    '```json\n{}\n```',
    '```\ncode\n```',
    '~~~js\ncode\n~~~',
  ]) {
    turns[0].output.assistantText = `${text} ${fence}`;
    expect(scoreJsonRefusalLexical(turns, inputs, expected).failures).toEqual([
      'Fenced JSON or code is forbidden',
    ]);
  }
});

test('malformed evidence and unregistered expectations fail closed; fixture is independent of request and expectations', async () => {
  const { item, data, inputs, expected } = documents();
  const { turns } = evidence();
  for (const invalid of [
    undefined,
    null,
    [],
    [turns[0], turns[0]],
    [{}],
    [{ ...turns[0], index: 1 }],
    [{ ...turns[0], input: { intent: 'changed' } }],
    [{ ...turns[0], output: { assistantText: null } }],
    [{ ...turns[0], output: { assistantText: 'x'.repeat(2001) } }],
    [{ ...turns[0], output: { ...data.response, executionPlan: [] } }],
    [{ ...turns[0], resultingState: undefined }],
  ])
    expect(scoreJsonRefusalLexical(invalid, inputs, expected).outcome).toBe(
      'fail',
    );
  expect(() => parseOfflineCase({ ...item.definition, lineage: [] })).toThrow();
  for (const expectations of [
    {},
    { ...expected, exactText: data.response.assistantText },
    { rule: 'exact-text' },
  ]) {
    expect(
      jsonRefusalLexicalExpectationsSchema.safeParse(expectations).success,
    ).toBe(false);
    expect(() =>
      parseOfflineCase({ ...item.definition, expectations }),
    ).toThrow();
    expect(
      scoreJsonRefusalLexical(turns, inputs, expectations as typeof expected)
        .outcome,
    ).toBe('fail');
  }
  expect(jsonRefusalLexicalInputsSchema.safeParse({ intent: '' }).success).toBe(
    false,
  );
  expect(
    jsonRefusalLexicalDataSchema.safeParse({
      response: { ...data.response, exactText: 'anything' },
    }).success,
  ).toBe(false);
  for (const fixture of [
    { ...item.fixture, kind: 'assistant-text-script' },
    { ...item.fixture, data: {} },
  ])
    expect(() => caseAdapter({ ...item, fixture })).toThrow();
  const changedInputs = {
    intent: 'Synthetic changed request, not interpreted',
  };
  const result = await evaluateSample(
    {
      runId: 'independence-controls',
      caseId: item.definition.id,
      runtimeId: 'scripted',
      sample: 1,
    },
    assistantJsonRefusalLexical(data, changedInputs, expected),
  );
  const observation = jsonRefusalLexicalObservationSchema.parse(
    result.observation,
  );
  expect(observation[0].input).toEqual(changedInputs);
  expect(observation[0].output).toEqual(data.response);
});
