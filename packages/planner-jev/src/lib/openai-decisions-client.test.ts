import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Instrument, InstrumentAttributes } from '@maelstrom-co/engine';
import { isErr, isOk } from '@maelstrom-co/protocol';
import {
  makeContext,
  makeInput,
  makeRequest,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import {
  buildDecisionsReply,
  type DecisionsRequest,
  type DecisionsScript,
  type DecisionsStep,
  decisionsPayload,
  scriptedDecisionsFetch,
} from './__test-helpers__/scripted-decisions-fetch.js';
import type { Payload } from './__test-helpers__/scripted-fetch.js';
import type { AskCall, CallOutcome } from './ask.js';
import {
  createDecisionsClient,
  DECISIONS_MODEL,
  type DecisionsClientOptions,
} from './openai-decisions-client.js';
import {
  choice,
  type Evaluation,
  MAX_CHOICES,
  noul,
  type Question,
  score,
} from './questions.js';
import type { InvalidReplyReason } from './reply-validation.js';

const KEY = 'decisions-secret-key-value';

const LEVELS = ['Nothing happened', 'Some of it happened', 'All of it'];

const evaluation: Evaluation = {
  state: { intent: 'hide the weather' },
  questions: {
    scope: choice('Is it supported?', {
      supported: 'yes',
      unsupported: 'no',
      ambiguous: 'unclear',
    }),
    'view/weather-main': choice('Next state', {
      keep: 'keep',
      hide: 'hide',
      delete: 'delete',
    }),
    'gate/needsActions': noul('Does it need actions?'),
    'size/weather-main': score('How much space?', LEVELS),
  },
};

const payload = (value: Evaluation): Payload =>
  JSON.parse(JSON.stringify({ model: DECISIONS_MODEL, ...value }));

const REPLIES_DIR = join(import.meta.dir, '__test-helpers__/decisions-replies');

const REFUSED_FIXTURES: Readonly<Record<string, string>> = {
  'layout-composed-pairs.json': 'fraction_in_group/calendar-main',
  'refusal-stage-isolated.json': 'fraction_in_group/calendar-main',
};

function setup(
  script: DecisionsScript,
  options: Partial<DecisionsClientOptions> = {},
) {
  const { fetch, calls, requests } = scriptedDecisionsFetch(
    script,
    DECISIONS_MODEL,
  );
  const recorded: AskCall[] = [];
  const ask = createDecisionsClient({
    apiKey: KEY,
    fetch,
    timeoutMs: 1000,
    onCall: (call) => recorded.push(call),
    ...options,
  });
  return { ask, calls, requests, recorded, ...spyLogger() };
}

function ctx(
  logger: ReturnType<typeof spyLogger>['logger'],
  signal?: AbortSignal,
) {
  return makeContext(makeInput(makeRequest('hide the weather')), {
    logger,
    signal,
  });
}

function replying(reply: unknown): DecisionsScript {
  return () => ({ reply });
}

describe('the Decisions request', () => {
  test('maps nouls to predicates, choices to choices and scores to levels, with the state as JSON input', async () => {
    const { ask, requests, logger } = setup(() => ({ choices: {} }));
    await ask('jevSelect', evaluation, ctx(logger));
    expect(requests[0]).toEqual({
      model: DECISIONS_MODEL,
      input: JSON.stringify(evaluation.state),
      questions: [
        {
          type: 'choice',
          name: 'scope',
          instructions: 'Is it supported?',
          choices: [
            { value: 'supported', description: 'yes' },
            { value: 'unsupported', description: 'no' },
            { value: 'ambiguous', description: 'unclear' },
          ],
        },
        {
          type: 'choice',
          name: 'view/weather-main',
          instructions: 'Next state',
          choices: [
            { value: 'keep', description: 'keep' },
            { value: 'hide', description: 'hide' },
            { value: 'delete', description: 'delete' },
          ],
        },
        {
          type: 'predicate',
          name: 'gate/needsActions',
          instructions: 'Does it need actions?',
        },
        {
          type: 'score',
          name: 'size/weather-main',
          instructions: 'How much space?',
          levels: LEVELS.map((description, level) => ({
            label: String(level),
            description,
          })),
        },
      ],
    });
  });

  test('stringifies object question texts and lets render replace the state and object texts', async () => {
    const structured: Evaluation = {
      state: { request: 'stack them' },
      questions: {
        pair: choice(
          { what: 'where', not_for: 'size' },
          { above: { what: 'above', examples: ['on top'] }, below: 'below' },
        ),
      },
    };
    const plain = setup(() => ({ choices: {} }));
    await plain.ask('jevLayout', structured, ctx(plain.logger));
    expect(plain.requests[0]?.questions[0]).toEqual({
      type: 'choice',
      name: 'pair',
      instructions: '{"what":"where","not_for":"size"}',
      choices: [
        {
          value: 'above',
          description: '{"what":"above","examples":["on top"]}',
        },
        { value: 'below', description: 'below' },
      ],
    });

    const rendered = setup(() => ({ choices: {} }), {
      render: (value) => `rendered ${Object.keys(value as object).join('+')}`,
    });
    await rendered.ask('jevLayout', structured, ctx(rendered.logger));
    expect(rendered.requests[0]?.input).toBe('rendered request');
    expect(rendered.requests[0]?.questions[0]).toEqual({
      type: 'choice',
      name: 'pair',
      instructions: 'rendered what+not_for',
      choices: [
        { value: 'above', description: 'rendered what+examples' },
        { value: 'below', description: 'below' },
      ],
    });
  });

  test('a render that throws rejects the call before any fetch', async () => {
    const { ask, calls, logger } = setup(() => ({ choices: {} }), {
      render: () => {
        throw new Error('render failed');
      },
    });
    await expect(ask('jevSelect', evaluation, ctx(logger))).rejects.toThrow(
      'render failed',
    );
    expect(calls).toHaveLength(0);
  });

  test('sends the key only in the Authorization header and defaults to gpt-6-luna', async () => {
    let headers: Headers | undefined;
    let url: unknown;
    const { fetch } = scriptedDecisionsFetch(() => ({ choices: {} }));
    const ask = createDecisionsClient({
      apiKey: KEY,
      fetch: (async (target: unknown, init?: RequestInit) => {
        url = target;
        headers = new Headers(init?.headers);
        return fetch(target as string, init);
      }) as typeof fetch,
    });
    const { logger } = spyLogger();
    await ask('jevSelect', evaluation, ctx(logger));
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(headers?.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers?.get('content-type')).toBe('application/json');
    expect([...(headers?.keys() ?? [])].sort()).toEqual([
      'authorization',
      'content-type',
    ]);
    expect(DECISIONS_MODEL).toBe('gpt-6-luna');
  });
});

describe('recorded live replies', () => {
  const files = readdirSync(REPLIES_DIR).filter((file) =>
    file.endsWith('.json'),
  );

  test('cover every probed stage case', () => {
    expect(files.sort()).toEqual(
      [
        'actions-per-instance.json',
        'actions-poc.json',
        'layout-composed-pairs.json',
        'layout-poc.json',
        'param-poc.json',
        'refusal-stage-isolated.json',
        'select-gated.json',
        'select-poc.json',
      ].sort(),
    );
  });

  for (const file of files)
    test(`${file} is sent as recorded and parses into the downstream answer shapes`, async () => {
      const recorded = JSON.parse(
        readFileSync(join(REPLIES_DIR, file), 'utf8'),
      ) as { request: DecisionsRequest; body: unknown };
      const decoded = decisionsPayload(recorded.request);
      const asked: Evaluation = {
        state: decoded.state,
        questions: decoded.questions as unknown as Record<string, Question>,
      };
      const {
        ask,
        requests,
        recorded: calls,
        logger,
      } = setup(replying(recorded.body));
      const result = await ask('jevLayout', asked, ctx(logger));
      expect(JSON.stringify(requests[0])).toBe(
        JSON.stringify(recorded.request),
      );

      const refused = REFUSED_FIXTURES[file];
      if (refused !== undefined) {
        expect(isErr(result) && result.error).toEqual({
          _tag: 'Deferred',
          reason: 'jevLayout/provider_refusal',
        });
        expect(calls[0]?.outcome).toBe('provider_refusal');
        expect(calls[0]?.usage?.inputTokens).toBeGreaterThan(0);
        return;
      }
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(calls[0]?.outcome).toBe('ok');
      expect(calls[0]?.usage?.outputTokens).toBe(0);
      expect(calls[0]?.usage?.inputTokens).toBeGreaterThan(0);
      expect(result.value.usage).toEqual(calls[0]?.usage as never);
      for (const [id, question] of Object.entries(asked.questions)) {
        const answer = result.value.answers[id];
        expect(answer).toBeDefined();
        if (answer === undefined) continue;
        if (question.type === 'noul') {
          expect(Object.keys(answer).sort()).toEqual(
            ['choice', 'confidence', 'probability'].sort(),
          );
          expect(['yes', 'no']).toContain(answer.choice);
        } else if (question.type === 'score') {
          const levels = question.criteria.map((_, level) => String(level));
          expect(Object.keys(answer.probabilities ?? {})).toEqual(levels);
          expect(levels).toContain(answer.choice);
          expect(typeof answer.score).toBe('number');
        } else {
          expect(Object.keys(answer).sort()).toEqual(['choice', 'confidence']);
          expect(Object.keys(question.criteria)).toContain(answer.choice);
          expect(Object.keys(answer.probabilities ?? {}).sort()).toEqual(
            Object.keys(question.criteria).sort(),
          );
        }
      }
    });

  test('a live score answer takes its level from the probabilities, not the rounded score', async () => {
    const recorded = JSON.parse(
      readFileSync(join(REPLIES_DIR, 'layout-composed-pairs.json'), 'utf8'),
    ) as { request: DecisionsRequest; body: { answers: unknown[] } };
    const sizeOnly: DecisionsRequest = {
      ...recorded.request,
      questions: recorded.request.questions.filter(
        (question) => question.name === 'size/calendar-main',
      ),
    };
    const decoded = decisionsPayload(sizeOnly);
    const { ask, logger } = setup(
      replying({
        ...recorded.body,
        answers: recorded.body.answers.filter(
          (answer) =>
            (answer as { name: string }).name === 'size/calendar-main',
        ),
      }),
    );
    const result = await ask(
      'jevLayout',
      {
        state: decoded.state,
        questions: decoded.questions as unknown as Record<string, Question>,
      },
      ctx(logger),
    );
    expect(isOk(result) && result.value.answers['size/calendar-main']).toEqual({
      choice: '2',
      confidence: 0.85,
      score: 1.9,
      probabilities: { '0': 0.02, '1': 0.1, '2': 0.85, '3': 0.02, '4': 0.01 },
    });
  });
});

describe('reply validation', () => {
  const valid = () =>
    buildDecisionsReply(payload(evaluation), {
      choices: { 'view/weather-main': 'hide' },
      confidence: 0.8,
      nouls: { 'gate/needsActions': 0.7 },
      scores: { 'size/weather-main': 2 },
      model: DECISIONS_MODEL,
    });
  type Raw = ReturnType<typeof valid>;
  type WireAnswer = Raw['answers'][number] & Record<string, unknown>;
  const replace = (raw: Raw, name: string, change: Partial<WireAnswer>) => ({
    ...raw,
    answers: raw.answers.map((answer) =>
      answer.name === name ? { ...answer, ...change } : answer,
    ),
  });

  test('accepts a well-formed reply with the downstream shapes and usage', async () => {
    const { ask, recorded, logger } = setup(replying(valid()));
    const result = await ask('jevSelect', evaluation, ctx(logger));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.answers).toEqual({
      scope: { choice: 'supported', confidence: 0.8 },
      'view/weather-main': { choice: 'hide', confidence: 0.8 },
      'gate/needsActions': {
        choice: 'yes',
        confidence: expect.closeTo(0.4, 10) as never,
        probability: 0.7,
      },
      'size/weather-main': {
        choice: '2',
        confidence: 0.8,
        score: 2,
        probabilities: { '0': 0, '1': 0, '2': 1 },
      },
    });
    expect(result.value.answers['view/weather-main']?.probabilities).toEqual({
      keep: 0,
      hide: 1,
      delete: 0,
    });
    expect(result.value.usage).toEqual({ inputTokens: 11, outputTokens: 0 });
    expect(recorded[0]?.answers?.['gate/needsActions']).toEqual({
      choice: 'yes',
      confidence: expect.closeTo(0.4, 10) as never,
      probability: 0.7,
      probabilities: { yes: 0.7, no: expect.closeTo(0.3, 10) as never },
    });
  });

  test('does not require the model to be echoed', async () => {
    const { ask, logger } = setup(replying({ ...valid(), model: 'other' }));
    expect(isOk(await ask('jevSelect', evaluation, ctx(logger)))).toBe(true);
  });

  const invalidReplies: readonly (readonly [
    string,
    (r: Raw) => unknown,
    InvalidReplyReason,
  ])[] = [
    [
      'answers that are not an array',
      (r: Raw) => ({ ...r, answers: {} }),
      'malformed_json',
    ],
    [
      'a missing answer',
      (r: Raw) => ({
        ...r,
        answers: r.answers.filter((answer) => answer.name !== 'scope'),
      }),
      'missing_answer',
    ],
    [
      'an extra answer',
      (r: Raw) => ({
        ...r,
        answers: [...r.answers, { ...r.answers[0], name: 'extra' }],
      }),
      'key_mismatch',
    ],
    [
      'a duplicate answer',
      (r: Raw) => ({ ...r, answers: [...r.answers, r.answers[0]] }),
      'key_mismatch',
    ],
    [
      'an answer without a name',
      (r: Raw) => replace(r, 'scope', { name: 1 as never }),
      'malformed_json',
    ],
    [
      'a predicate answer to a choice question',
      (r: Raw) =>
        replace(r, 'scope', { type: 'predicate', probability: 0.5 } as never),
      'wrong_type',
    ],
    [
      'a choice answer to a predicate question',
      (r: Raw) => replace(r, 'gate/needsActions', { type: 'choice' } as never),
      'wrong_type',
    ],
    [
      'a choice answer to a score question',
      (r: Raw) => replace(r, 'size/weather-main', { type: 'choice' } as never),
      'wrong_type',
    ],
    [
      'a choice outside the options',
      (r: Raw) => replace(r, 'scope', { choice: 'maybe' } as never),
      'key_mismatch',
    ],
    [
      'choice probabilities that do not sum to one',
      (r: Raw) =>
        replace(r, 'scope', {
          probabilities: [
            { value: 'supported', probability: 0.9 },
            { value: 'unsupported', probability: 0.05 },
            { value: 'ambiguous', probability: 0 },
          ],
        } as never),
      'probability_sum',
    ],
    [
      'a choice without the highest probability',
      (r: Raw) =>
        replace(r, 'scope', {
          probabilities: [
            { value: 'supported', probability: 0.2 },
            { value: 'unsupported', probability: 0.8 },
            { value: 'ambiguous', probability: 0 },
          ],
        } as never),
      'not_most_probable',
    ],
    [
      'a choice probability listed twice',
      (r: Raw) =>
        replace(r, 'scope', {
          probabilities: [
            { value: 'supported', probability: 1 },
            { value: 'supported', probability: 0 },
            { value: 'ambiguous', probability: 0 },
          ],
        } as never),
      'key_mismatch',
    ],
    [
      'a predicate probability outside [0, 1]',
      (r: Raw) =>
        replace(r, 'gate/needsActions', { probability: 1.2 } as never),
      'out_of_range',
    ],
    [
      'a score out of range',
      (r: Raw) => replace(r, 'size/weather-main', { score: 2.5 } as never),
      'out_of_range',
    ],
    [
      'score probabilities over a level that does not exist',
      (r: Raw) =>
        replace(r, 'size/weather-main', {
          probabilities: [
            { value: 0, label: '0', probability: 0 },
            { value: 1, label: '1', probability: 0 },
            { value: 3, label: '3', probability: 1 },
          ],
        } as never),
      'key_mismatch',
    ],
    [
      'score probabilities keyed by label only',
      (r: Raw) =>
        replace(r, 'size/weather-main', {
          probabilities: [
            { label: '0', probability: 0 },
            { label: '1', probability: 0 },
            { label: '2', probability: 1 },
          ],
        } as never),
      'key_mismatch',
    ],
    [
      'missing usage',
      (r: Raw) => ({ ...r, usage: undefined }),
      'malformed_json',
    ],
    [
      'non-integral usage',
      (r: Raw) => ({ ...r, usage: { input_tokens: 1.5, output_tokens: 0 } }),
      'malformed_json',
    ],
    [
      'an answer that is not an object',
      (r: Raw) => ({ ...r, answers: [null, ...r.answers] }),
      'malformed_json',
    ],
    [
      'an answer of an unknown type',
      (r: Raw) => replace(r, 'scope', { type: 'text' } as never),
      'malformed_json',
    ],
    [
      'choice probabilities that are not an array',
      (r: Raw) =>
        replace(r, 'scope', { probabilities: 'not an array' } as never),
      'malformed_json',
    ],
    [
      'a probability entry that is not an object',
      (r: Raw) =>
        replace(r, 'scope', {
          probabilities: [null, { value: 'supported', probability: 1 }],
        } as never),
      'malformed_json',
    ],
    [
      'a choice probability keyed by a number',
      (r: Raw) =>
        replace(r, 'scope', {
          probabilities: [
            { value: 1, probability: 1 },
            { value: 'unsupported', probability: 0 },
            { value: 'ambiguous', probability: 0 },
          ],
        } as never),
      'malformed_json',
    ],
    [
      'a predicate probability given as a string',
      (r: Raw) =>
        replace(r, 'gate/needsActions', { probability: '0.5' } as never),
      'malformed_json',
    ],
    [
      'a choice answer without a confidence',
      (r: Raw) => replace(r, 'scope', { confidence: undefined } as never),
      'malformed_json',
    ],
    [
      'a choice given as a number',
      (r: Raw) => replace(r, 'scope', { choice: 1 } as never),
      'malformed_json',
    ],
    [
      'a score probability given as a string',
      (r: Raw) =>
        replace(r, 'size/weather-main', {
          probabilities: [
            { value: 0, label: '0', probability: 0 },
            { value: 1, label: '1', probability: 0 },
            { value: 2, label: '2', probability: '1' },
          ],
        } as never),
      'malformed_json',
    ],
  ];

  test.each(
    invalidReplies,
  )('rejects %s as provider_invalid_reply tagged with its reason', async (_name, mutate, reason) => {
    const { ask, recorded, logger, entries } = setup(replying(mutate(valid())));
    const result = await ask('jevSelect', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevSelect/provider_invalid_reply',
    });
    expect(recorded[0]?.outcome).toBe('provider_invalid_reply');
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data,
    ).toEqual({
      stage: 'jevSelect',
      reason: 'jevSelect/provider_invalid_reply',
      detail: `invalid reply (${reason})`,
      failure: { kind: 'invalid_reply', reason },
    });
  });
});

describe('refusals', () => {
  test('a refused question defers provider_refusal naming the question', async () => {
    const { ask, recorded, logger, entries } = setup(() => ({
      refuse: ['view/weather-main'],
    }));
    const result = await ask('jevSelect', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevSelect/provider_refusal',
    });
    expect(entries.find((entry) => entry.msg === 'jev.defer')?.data).toEqual({
      stage: 'jevSelect',
      reason: 'jevSelect/provider_refusal',
      question: 'view/weather-main',
    });
    const failure = entries.find(
      (entry) => entry.msg === 'jev.provider_failure',
    );
    expect(failure?.level).toBe('warn');
    expect(failure?.data).toEqual({
      stage: 'jevSelect',
      reason: 'jevSelect/provider_refusal',
      detail: 'refused view/weather-main',
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outcome).toBe('provider_refusal');
    expect(recorded[0]?.answers).toBe(undefined);
    expect(recorded[0]?.usage).toEqual({ inputTokens: 11, outputTokens: 0 });
    expect(
      entries.find((entry) => entry.msg === 'jev.call')?.data,
    ).toMatchObject({
      outcome: 'provider_refusal',
      inputTokens: 11,
      outputTokens: 0,
    });
  });

  test('a refusal next to a malformed answer still defers provider_refusal with usage', async () => {
    const refusing = buildDecisionsReply(payload(evaluation), {
      refuse: ['view/weather-main'],
      model: DECISIONS_MODEL,
    });
    const reply = {
      ...refusing,
      answers: refusing.answers.map((answer) =>
        answer.name === 'scope'
          ? { ...answer, probabilities: 'not an array' }
          : answer,
      ),
    };
    const { ask, recorded, logger } = setup(replying(reply));
    const result = await ask('jevSelect', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevSelect/provider_refusal',
    });
    expect(recorded[0]?.outcome).toBe('provider_refusal');
    expect(recorded[0]?.usage).toEqual({ inputTokens: 11, outputTokens: 0 });
  });

  test('defers on the first refused question in question order, not reply order', async () => {
    const refusing = buildDecisionsReply(payload(evaluation), {
      refuse: ['size/weather-main', 'scope'],
      model: DECISIONS_MODEL,
    });
    const { ask, logger, entries } = setup(
      replying({ ...refusing, answers: [...refusing.answers].reverse() }),
    );
    await ask('jevLayout', evaluation, ctx(logger));
    expect(
      entries.find((entry) => entry.msg === 'jev.defer')?.data?.question,
    ).toBe('scope');
  });
});

describe('createDecisionsClient', () => {
  test('reports each call to the logger, the instrument and onCall with the TypeSafe keys', async () => {
    const { ask, recorded, logger, entries } = setup(() => ({
      choices: { 'view/weather-main': 'hide' },
    }));
    const events: { name: string; attributes: InstrumentAttributes }[] = [];
    const instrument: Instrument = {
      stage: (_name, stage) => stage,
      event: (name, attributes) => events.push({ name, attributes }),
    };
    await ask(
      'jevSelect',
      evaluation,
      makeContext(makeInput(makeRequest('hide the weather')), {
        logger,
        instrument,
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('jev.call');
    const attributes = events[0]?.attributes ?? {};
    expect(attributes).toMatchObject({
      'gen_ai.request.model': 'gpt-6-luna',
      'gen_ai.usage.input_tokens': 11,
      'gen_ai.usage.output_tokens': 0,
      'maelstrom.stage': 'jevSelect',
      'maelstrom.outcome': 'ok',
      'maelstrom.question_ids':
        'scope,view/weather-main,gate/needsActions,size/weather-main',
    });
    expect(Object.keys(attributes).sort()).toEqual(
      [
        'gen_ai.request.model',
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.output_tokens',
        'maelstrom.latency_ms',
        'maelstrom.outcome',
        'maelstrom.question_ids',
        'maelstrom.stage',
      ].sort(),
    );

    const call = entries.find((entry) => entry.msg === 'jev.call');
    expect(call?.level).toBe('debug');
    expect(call?.data).toMatchObject({
      stage: 'jevSelect',
      model: 'gpt-6-luna',
      questionIds: Object.keys(evaluation.questions),
      outcome: 'ok',
      inputTokens: 11,
      outputTokens: 0,
    });

    expect(recorded).toHaveLength(1);
    expect(Object.keys(recorded[0] ?? {}).sort()).toEqual(
      [
        'answers',
        'latencyMs',
        'outcome',
        'questionIds',
        'stage',
        'usage',
      ].sort(),
    );
    expect(recorded[0]).toMatchObject({
      stage: 'jevSelect',
      outcome: 'ok',
      usage: { inputTokens: 11, outputTokens: 0 },
    });
  });

  test('logs the raw reply only when logReplies is on', async () => {
    const script: DecisionsScript = () => ({ choices: {} });
    const quiet = setup(script);
    await quiet.ask('jevSelect', evaluation, ctx(quiet.logger));
    expect(quiet.entries.some((entry) => entry.msg === 'jev.reply')).toBe(
      false,
    );

    const loud = setup(script, { logReplies: true });
    await loud.ask('jevSelect', evaluation, ctx(loud.logger));
    const reply = loud.entries.find((entry) => entry.msg === 'jev.reply');
    expect(reply?.level).toBe('debug');
    expect(reply?.data?.stage).toBe('jevSelect');
    expect(JSON.parse(String(reply?.data?.state))).toEqual(evaluation.state);
    expect(JSON.parse(String(reply?.data?.questions))).toEqual(
      JSON.parse(JSON.stringify(evaluation.questions)),
    );
    expect(JSON.parse(String(reply?.data?.reply))).toMatchObject({
      model: DECISIONS_MODEL,
    });
    expect(JSON.stringify(reply?.data)).not.toContain(KEY);
  });

  test('a timeout becomes a provider_timeout deferral', async () => {
    const { ask, recorded, logger, entries } = setup(() => 'hang', {
      timeoutMs: 20,
    });
    const result = await ask('jevLayout', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevLayout/provider_timeout',
    });
    expect(recorded[0]?.outcome).toBe('provider_timeout');
    expect(
      entries.some(
        (entry) =>
          entry.level === 'warn' && entry.msg === 'jev.provider_failure',
      ),
    ).toBe(true);
  });

  test('a user abort is a CancellationError, not a deferral', async () => {
    const { ask, recorded, logger } = setup(() => 'hang', {
      timeoutMs: 5000,
    });
    const controller = new AbortController();
    const pending = ask(
      'jevSelect',
      evaluation,
      ctx(logger, controller.signal),
    );
    await Bun.sleep(5);
    controller.abort('user left');
    const result = await pending;
    expect(isErr(result) && result.error._tag).toBe('CancellationError');
    expect(recorded[0]?.outcome).toBe('cancelled');
  });

  test('an already aborted request makes no call', async () => {
    const { ask, calls, logger } = setup(() => ({ choices: {} }));
    const controller = new AbortController();
    controller.abort('gone');
    const result = await ask(
      'jevSelect',
      evaluation,
      ctx(logger, controller.signal),
    );
    expect(isErr(result) && result.error._tag).toBe('CancellationError');
    expect(calls).toHaveLength(0);
  });

  const failures: readonly (readonly [string, DecisionsStep, CallOutcome])[] = [
    ['HTTP 500', { status: 500 }, 'provider_http'],
    ['a network failure', 'network', 'provider_network'],
    ['malformed JSON', { body: '{not json' }, 'provider_invalid_reply'],
    ['an oversized body', 'oversized', 'provider_invalid_reply'],
  ];
  test.each(failures)('%s maps to %s', async (_name, step, code) => {
    const { ask, recorded, logger } = setup(() => step);
    const result = await ask('jevActions', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: `jevActions/${code}`,
    });
    expect(recorded[0]?.outcome).toBe(code);
    expect(recorded[0]?.answers).toBe(undefined);
    expect(recorded[0]?.usage).toBe(undefined);
  });

  test('defers option_cap before calling when a question has too many options', async () => {
    const { ask, calls, recorded, logger } = setup(() => ({ choices: {} }));
    const criteria = Object.fromEntries(
      Array.from({ length: MAX_CHOICES + 1 }, (_, i) => [
        `o${i}`,
        `option ${i}`,
      ]),
    );
    const result = await ask(
      'jevLayout',
      { state: {}, questions: { layout: choice('pick', criteria) } },
      ctx(logger),
    );
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevLayout/option_cap',
    });
    expect(calls).toHaveLength(0);
    expect(recorded[0]?.outcome).toBe('option_cap');
  });
});

describe('the key never leaks', () => {
  test.each([
    ['a missing key', { apiKey: '' }, /apiKey/],
    ['an empty model', { apiKey: KEY, model: '' }, /model/],
    ['a bad endpoint', { apiKey: KEY, endpoint: 'nope' }, /endpoint/],
    ['a bad fetch', { apiKey: KEY, fetch: 'nope' as never }, /fetch/],
    ['a bad timeout', { apiKey: KEY, timeoutMs: 0 }, /timeoutMs/],
    ['a bad onCall', { apiKey: KEY, onCall: 'nope' as never }, /onCall/],
    [
      'a bad logReplies',
      { apiKey: KEY, logReplies: 'yes' as never },
      /logReplies/,
    ],
    ['a bad render', { apiKey: KEY, render: 'nope' as never }, /render/],
  ])('construction rejects %s without echoing the key', (_name, options, pattern) => {
    let caught: unknown;
    try {
      createDecisionsClient(options as DecisionsClientOptions);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/^Invalid Decisions option: /);
    expect((caught as Error).message).toMatch(pattern);
    expect((caught as Error).message).not.toContain(KEY);
  });

  test('a 401 whose body echoes the key reaches no error, log, instrument attribute or call record', async () => {
    const echoing = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${KEY}`,
            type: KEY,
            code: 'invalid_api_key',
          },
        }),
        { status: 401 },
      )) as unknown as typeof fetch;
    const recorded: AskCall[] = [];
    const ask = createDecisionsClient({
      apiKey: KEY,
      fetch: echoing,
      logReplies: true,
      onCall: (call) => recorded.push(call),
    });
    const { logger, entries } = spyLogger();
    const events: unknown[] = [];
    const instrument: Instrument = {
      stage: (_name, stage) => stage,
      event: (name, attributes) => events.push({ name, attributes }),
    };
    const result = await ask(
      'jevSelect',
      evaluation,
      makeContext(makeInput(makeRequest('hide the weather')), {
        logger,
        instrument,
      }),
    );
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevSelect/provider_http',
    });
    const captured = JSON.stringify({ result, entries, events, recorded });
    expect(captured).not.toContain(KEY);
    expect(entries.length).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data
        ?.failure,
    ).toEqual({ kind: 'http', status: 401, errorCode: 'invalid_api_key' });
  });
});
