import { describe, expect, test } from 'bun:test';

import type { Instrument, InstrumentAttributes } from '@maelstrom-co/engine';
import { isErr, isOk } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeInput,
  makeRequest,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import {
  buildReply,
  type Payload,
  type Script,
  type Step,
  scriptedFetch,
  TEST_MODEL,
} from './__test-helpers__/scripted-fetch.js';
import {
  choice,
  type Evaluation,
  MAX_CHOICES,
  noul,
  score,
} from './questions.js';
import type { InvalidReplyReason } from './reply-validation.js';
import {
  type CallOutcome,
  createTypeSafeClient,
  type JevCall,
  type TypeSafeClientOptions,
  validateReply,
} from './typesafe-client.js';

const KEY = 'typesafe-secret-key-value';

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
  },
};

const payload: Payload = JSON.parse(
  JSON.stringify({ model: TEST_MODEL, ...evaluation }),
);

function setup(
  script: Script,
  options: { timeoutMs?: number; logReplies?: boolean } = {},
) {
  const { fetch, calls } = scriptedFetch(script);
  const recorded: JevCall[] = [];
  const ask = createTypeSafeClient({
    apiKey: KEY,
    model: TEST_MODEL,
    fetch,
    timeoutMs: options.timeoutMs ?? 1000,
    onCall: (call) => recorded.push(call),
    ...(options.logReplies !== undefined && {
      logReplies: options.logReplies,
    }),
  });
  const spy = spyLogger();
  return { ask, calls, recorded, ...spy };
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

describe('validateReply', () => {
  const valid = () => buildReply(payload, { 'view/weather-main': 'hide' }, 0.8);

  test('accepts a well-formed reply and keeps usage', () => {
    const reply = validateReply(valid(), evaluation, TEST_MODEL);
    expect(reply?.answers['view/weather-main']).toEqual({
      choice: 'hide',
      confidence: 0.8,
    });
    expect(reply?.usage).toEqual({ inputTokens: 11, outputTokens: 2 });
  });

  test('keeps every option probability on a choice answer, out of its spread and JSON', () => {
    const answer = validateReply(valid(), evaluation, TEST_MODEL)?.answers[
      'view/weather-main'
    ];
    expect(answer?.probabilities).toEqual({ keep: 0, hide: 1, delete: 0 });
    expect({ ...answer }).toEqual({ choice: 'hide', confidence: 0.8 });
    expect(JSON.parse(JSON.stringify(answer))).toEqual({
      choice: 'hide',
      confidence: 0.8,
    });
  });

  test.each([
    [
      'a different model',
      (r: ReturnType<typeof valid>) => ({ ...r, model: 'other' }),
    ],
    [
      'a missing question id',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: { scope: r.answers.scope },
      }),
    ],
    [
      'an extra question id',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: { ...r.answers, extra: r.answers.scope },
      }),
    ],
    [
      'a choice outside the criteria',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: {
          ...r.answers,
          scope: { ...r.answers.scope, choice: 'maybe' },
        },
      }),
    ],
    [
      'probabilities over the wrong options',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: {
          ...r.answers,
          scope: {
            ...r.answers.scope,
            probabilities: { supported: 1, unsupported: 0 },
          },
        },
      }),
    ],
    [
      'probabilities that do not sum to one',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: {
          ...r.answers,
          scope: {
            ...r.answers.scope,
            probabilities: { supported: 0.9, unsupported: 0.05, ambiguous: 0 },
          },
        },
      }),
    ],
    [
      'a chosen option without the highest probability',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: {
          ...r.answers,
          scope: {
            ...r.answers.scope,
            probabilities: { supported: 0.2, unsupported: 0.8, ambiguous: 0 },
          },
        },
      }),
    ],
    [
      'a confidence outside [0, 1]',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: {
          ...r.answers,
          scope: { ...r.answers.scope, confidence: 1.5 },
        },
      }),
    ],
    [
      'non-integer usage',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        usage: { input_tokens: 1.5, output_tokens: 2 },
      }),
    ],
    [
      'a non-choice answer type',
      (r: ReturnType<typeof valid>) => ({
        ...r,
        answers: { ...r.answers, scope: { ...r.answers.scope, type: 'text' } },
      }),
    ],
  ])('rejects %s', (_name, mutate) => {
    expect(validateReply(mutate(valid()), evaluation, TEST_MODEL)).toBe(
      undefined,
    );
  });
});

describe('validateReply with noul questions', () => {
  const gated: Evaluation = {
    state: { intent: 'set the weather to Warsaw' },
    questions: {
      scope: choice('Is it supported?', {
        supported: 'yes',
        unsupported: 'no',
      }),
      needsActions: noul('Does it need actions?'),
    },
  };
  const gatedPayload: Payload = JSON.parse(
    JSON.stringify({ model: TEST_MODEL, ...gated }),
  );
  const reply = (probability: number) =>
    buildReply(gatedPayload, {}, 0.9, TEST_MODEL, {
      needsActions: probability,
    });

  test('reads a noul answer as a yes/no choice carrying its probability', () => {
    expect(validateReply(reply(0.75), gated, TEST_MODEL)?.answers).toEqual({
      scope: { choice: 'supported', confidence: 0.9 },
      needsActions: { choice: 'yes', confidence: 0.5, probability: 0.75 },
    });
    expect(
      validateReply(reply(0.1), gated, TEST_MODEL)?.answers.needsActions,
    ).toEqual({ choice: 'no', confidence: 0.8, probability: 0.1 });
    expect(
      validateReply(reply(0.5), gated, TEST_MODEL)?.answers.needsActions,
    ).toEqual({ choice: 'yes', confidence: 0, probability: 0.5 });
  });

  test.each([
    ['a noul outside [0, 1]', { type: 'noul', noul: 1.2 }],
    ['a missing noul value', { type: 'noul' }],
    [
      'a choice answer to a noul question',
      {
        type: 'choice',
        choice: 'yes',
        confidence: 1,
        probabilities: { yes: 1 },
      },
    ],
  ])('rejects %s', (_name, answer) => {
    const raw = reply(0.8);
    expect(
      validateReply(
        { ...raw, answers: { ...raw.answers, needsActions: answer } },
        gated,
        TEST_MODEL,
      ),
    ).toBe(undefined);
  });

  test('rejects a noul answer to a choice question', () => {
    const raw = reply(0.8);
    expect(
      validateReply(
        {
          ...raw,
          answers: { ...raw.answers, scope: { type: 'noul', noul: 0.9 } },
        },
        gated,
        TEST_MODEL,
      ),
    ).toBe(undefined);
  });

  test('onCall reports a noul answer with yes and no probabilities', async () => {
    const { ask, recorded, logger } = setup(() => ({
      choices: {},
      nouls: { needsActions: 0.25 },
    }));
    await ask('jevSelect', gated, ctx(logger));
    expect(recorded[0]?.answers?.needsActions).toEqual({
      choice: 'no',
      confidence: 0.5,
      probability: 0.25,
      probabilities: { yes: 0.25, no: 0.75 },
    });
  });
});

describe('validateReply with score questions', () => {
  const LEVELS = ['Nothing happened', 'Some of it happened', 'All of it'];
  const graded: Evaluation = {
    state: { intent: 'hide the weather' },
    questions: {
      scope: choice('Is it supported?', {
        supported: 'yes',
        unsupported: 'no',
      }),
      satisfied: score('Did the response do what was asked?', LEVELS),
    },
  };
  const gradedPayload: Payload = JSON.parse(
    JSON.stringify({ model: TEST_MODEL, ...graded }),
  );
  const scoreAnswer = {
    type: 'score',
    score: 1.43,
    confidence: 0.35,
    legend: { '0': LEVELS[0], '1': LEVELS[1], '2': LEVELS[2] },
    probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
  };
  const raw = (answer: unknown = scoreAnswer) => {
    const built = buildReply(gradedPayload, {}, 0.9);
    return { ...built, answers: { ...built.answers, satisfied: answer } };
  };

  test('sends the levels as the ordered criteria array', async () => {
    const { ask, calls, logger } = setup(() => ({ choices: {} }));
    await ask('jevSelect', graded, ctx(logger));
    expect(calls[0]?.questions.satisfied as unknown).toEqual({
      type: 'score',
      instructions: 'Did the response do what was asked?',
      criteria: LEVELS,
    });
  });

  test('reads a score answer with its fractional score and per-level probabilities', () => {
    expect(validateReply(raw(), graded, TEST_MODEL)?.answers).toEqual({
      scope: { choice: 'supported', confidence: 0.9 },
      satisfied: {
        choice: '1',
        confidence: 0.35,
        score: 1.43,
        probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
      },
    });
  });

  test('picks the lower level on a tie for the most probable level', () => {
    const tied = {
      ...scoreAnswer,
      score: 0.5,
      probabilities: { '0': 0.5, '1': 0.5, '2': 0 },
    };
    expect(
      validateReply(raw(tied), graded, TEST_MODEL)?.answers.satisfied?.choice,
    ).toBe('0');
  });

  test('accepts probabilities that sum to one within 0.02', () => {
    const near = {
      ...scoreAnswer,
      probabilities: { '0': 0.01, '1': 0.57, '2': 0.43 },
    };
    expect(validateReply(raw(near), graded, TEST_MODEL)).not.toBe(undefined);
  });

  test('accepts the end points of the score range', () => {
    for (const [value, level] of [
      [0, '0'],
      [2, '2'],
    ] as const) {
      const probabilities = { '0': 0, '1': 0, '2': 0, [level]: 1 };
      expect(
        validateReply(
          raw({ ...scoreAnswer, score: value, probabilities }),
          graded,
          TEST_MODEL,
        )?.answers.satisfied?.score,
      ).toBe(value);
    }
  });

  test.each([
    [
      'probabilities that sum well under one',
      { ...scoreAnswer, probabilities: { '0': 0, '1': 0.5, '2': 0.43 } },
    ],
    [
      'probabilities that sum well over one',
      { ...scoreAnswer, probabilities: { '0': 0.1, '1': 0.57, '2': 0.43 } },
    ],
    [
      'a probability outside [0, 1]',
      { ...scoreAnswer, probabilities: { '0': -0.2, '1': 0.77, '2': 0.43 } },
    ],
    [
      'probabilities missing a level',
      { ...scoreAnswer, probabilities: { '1': 0.57, '2': 0.43 } },
    ],
    [
      'probabilities over an extra level',
      {
        ...scoreAnswer,
        probabilities: { '0': 0, '1': 0.57, '2': 0.43, '3': 0 },
      },
    ],
    [
      'levels echoed out of order',
      {
        ...scoreAnswer,
        legend: { '0': LEVELS[1], '1': LEVELS[0], '2': LEVELS[2] },
      },
    ],
    [
      'a level echoed with different text',
      {
        ...scoreAnswer,
        legend: { '0': LEVELS[0], '1': 'Half of it', '2': LEVELS[2] },
      },
    ],
    [
      'a legend missing a level',
      { ...scoreAnswer, legend: { '0': LEVELS[0], '1': LEVELS[1] } },
    ],
    [
      'a legend with an extra level',
      {
        ...scoreAnswer,
        legend: { '0': LEVELS[0], '1': LEVELS[1], '2': LEVELS[2], '3': 'x' },
      },
    ],
    ['a missing legend', { ...scoreAnswer, legend: undefined }],
    ['a score below zero', { ...scoreAnswer, score: -0.1 }],
    ['a score above the top level', { ...scoreAnswer, score: 2.1 }],
    ['a non-numeric score', { ...scoreAnswer, score: '1.43' }],
    ['a confidence outside [0, 1]', { ...scoreAnswer, confidence: 1.2 }],
    ['a noul answer to a score question', { type: 'noul', noul: 0.4 }],
    [
      'a choice answer to a score question',
      {
        type: 'choice',
        choice: '1',
        confidence: 0.35,
        probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
      },
    ],
  ])('rejects %s', (_name, answer) => {
    expect(validateReply(raw(answer), graded, TEST_MODEL)).toBe(undefined);
  });

  test('rejects a score answer to a choice question', () => {
    const built = raw();
    expect(
      validateReply(
        { ...built, answers: { ...built.answers, scope: scoreAnswer } },
        graded,
        TEST_MODEL,
      ),
    ).toBe(undefined);
  });

  test('onCall and the reply both carry the score answer', async () => {
    const { ask, recorded, logger } = setup(() => ({
      choices: {},
      confidence: 0.6,
      scores: { satisfied: 2 },
    }));
    const result = await ask('jevSelect', graded, ctx(logger));
    const expected = {
      choice: '2',
      confidence: 0.6,
      score: 2,
      probabilities: { '0': 0, '1': 0, '2': 1 },
    };
    expect(recorded[0]?.answers?.satisfied).toEqual(expected);
    expect(isOk(result) && result.value.answers.satisfied).toEqual(expected);
  });
});

describe('the grader caller label', () => {
  test('reports calls and deferrals under grader, not a stage', async () => {
    const ok = setup(() => ({ choices: {} }));
    await ok.ask('grader', evaluation, ctx(ok.logger));
    expect(ok.recorded[0]).toMatchObject({ stage: 'grader', outcome: 'ok' });

    const failing = setup(() => ({ status: 503 }));
    const result = await failing.ask('grader', evaluation, ctx(failing.logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'grader/provider_http',
    });
    expect(failing.recorded[0]).toMatchObject({
      stage: 'grader',
      outcome: 'provider_http',
    });
  });
});

describe('createTypeSafeClient', () => {
  test('returns the validated reply and reports the call', async () => {
    const { ask, calls, recorded, logger, entries } = setup(() => ({
      choices: { 'view/weather-main': 'hide' },
    }));
    const result = await ask('jevSelect', evaluation, ctx(logger));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.answers['view/weather-main']?.choice).toBe('hide');
    expect(calls[0]?.model).toBe(TEST_MODEL);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      stage: 'jevSelect',
      questionIds: ['scope', 'view/weather-main'],
      outcome: 'ok',
      usage: { inputTokens: 11, outputTokens: 2 },
    });
    const call = entries.find((entry) => entry.msg === 'jev.call');
    expect(call?.level).toBe('debug');
    expect(call?.data).toMatchObject({
      stage: 'jevSelect',
      outcome: 'ok',
      inputTokens: 11,
      outputTokens: 2,
    });
    expect(typeof call?.data?.latencyMs).toBe('number');
  });

  test('reports each call to the stage instrument with the GenAI and Maelstrom keys', async () => {
    const { ask, logger } = setup(() => ({
      choices: { 'view/weather-main': 'hide' },
    }));
    const events: { name: string; attributes: InstrumentAttributes }[] = [];
    const instrument: Instrument = {
      stage: (_name, stage) => stage,
      event: (name, attributes) => events.push({ name, attributes }),
    };
    const input = makeInput(makeRequest('hide the weather'));

    await ask(
      'jevSelect',
      evaluation,
      makeContext(input, { logger, instrument }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('jev.call');
    const attributes = events[0]?.attributes ?? {};
    expect(attributes).toMatchObject({
      'gen_ai.request.model': TEST_MODEL,
      'gen_ai.usage.input_tokens': 11,
      'gen_ai.usage.output_tokens': 2,
      'maelstrom.stage': 'jevSelect',
      'maelstrom.outcome': 'ok',
      'maelstrom.question_ids': 'scope,view/weather-main',
    });
    expect(typeof attributes['maelstrom.latency_ms']).toBe('number');
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
  });

  test('a failed call reports no token usage to the instrument', async () => {
    const { ask, logger } = setup(() => ({ status: 500 }));
    const events: InstrumentAttributes[] = [];
    const instrument: Instrument = {
      stage: (_name, stage) => stage,
      event: (_name, attributes) => events.push(attributes),
    };
    const input = makeInput(makeRequest('hide the weather'));

    await ask(
      'jevActions',
      evaluation,
      makeContext(input, { logger, instrument }),
    );

    expect(events[0]).toMatchObject({
      'maelstrom.stage': 'jevActions',
      'maelstrom.outcome': 'provider_http',
    });
    expect(events[0]).not.toHaveProperty('gen_ai.usage.input_tokens');
    expect(events[0]).not.toHaveProperty('gen_ai.usage.output_tokens');
  });

  test('onCall carries the validated answers with their probabilities', async () => {
    const { ask, recorded, logger } = setup(() => ({
      choices: { 'view/weather-main': 'hide' },
      confidence: 0.7,
    }));
    const result = await ask('jevSelect', evaluation, ctx(logger));
    expect(recorded[0]?.answers).toEqual({
      scope: {
        choice: 'supported',
        confidence: 0.7,
        probabilities: { supported: 1, unsupported: 0, ambiguous: 0 },
      },
      'view/weather-main': {
        choice: 'hide',
        confidence: 0.7,
        probabilities: { keep: 0, hide: 1, delete: 0 },
      },
    });
    expect(isOk(result) && result.value.answers.scope).toEqual({
      choice: 'supported',
      confidence: 0.7,
    });
  });

  test('logs the raw reply only when logReplies is on', async () => {
    const script: Script = () => ({
      choices: { 'view/weather-main': 'hide' },
    });
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
    expect(JSON.parse(String(reply?.data?.state))).toEqual(
      JSON.parse(JSON.stringify(evaluation.state)),
    );
    expect(JSON.parse(String(reply?.data?.questions))).toEqual(
      JSON.parse(JSON.stringify(evaluation.questions)),
    );
    expect(JSON.parse(String(reply?.data?.reply))).toMatchObject({
      model: TEST_MODEL,
    });
    expect(JSON.stringify(reply?.data)).not.toContain(KEY);
  });

  test('a timeout becomes a provider_timeout deferral', async () => {
    const { ask, logger, entries } = setup(() => 'hang', { timeoutMs: 20 });
    const result = await ask('jevLayout', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevLayout/provider_timeout',
    });
    expect(
      entries.some(
        (entry) =>
          entry.level === 'warn' && entry.msg === 'jev.provider_failure',
      ),
    ).toBe(true);
    expect(
      entries.find((entry) => entry.msg === 'jev.defer')?.data,
    ).toMatchObject({
      stage: 'jevLayout',
      reason: 'jevLayout/provider_timeout',
    });
  });

  test('a user abort is a CancellationError, not a deferral', async () => {
    const { ask, logger } = setup(() => 'hang', { timeoutMs: 5000 });
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

  const failures: readonly (readonly [string, Step, CallOutcome])[] = [
    ['HTTP 500', { status: 500 }, 'provider_http'],
    ['a network failure', 'network', 'provider_network'],
    ['malformed JSON', { body: '{not json' }, 'provider_invalid_reply'],
    ['an oversized body', 'oversized', 'provider_invalid_reply'],
    [
      'a reply failing validation',
      { reply: { model: 'wrong' } },
      'provider_invalid_reply',
    ],
  ];
  test.each(failures)('%s maps to %s', async (_name, step, code) => {
    const { ask, recorded, logger, entries } = setup(() => step);
    const result = await ask('jevActions', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: `jevActions/${code}`,
    });
    expect(recorded[0]?.outcome).toBe(code);
    expect(recorded[0]?.answers).toBe(undefined);
    expect(JSON.stringify(entries)).not.toContain(KEY);
  });

  test('defers option_cap before calling when a question has too many options', async () => {
    const { ask, calls, logger } = setup(() => ({ choices: {} }));
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
  });

  test.each([
    ['a missing key', { apiKey: '', model: TEST_MODEL }, /apiKey/],
    ['a missing model', { apiKey: KEY, model: '' }, /model/],
    [
      'a bad endpoint',
      { apiKey: KEY, model: TEST_MODEL, endpoint: 'nope' },
      /endpoint/,
    ],
    [
      'a bad timeout',
      { apiKey: KEY, model: TEST_MODEL, timeoutMs: 0 },
      /timeoutMs/,
    ],
  ])('construction rejects %s without echoing the key', (_name, options, pattern) => {
    let caught: unknown;
    try {
      createTypeSafeClient(options);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(pattern);
    expect((caught as Error).message).not.toContain(KEY);
  });
});

describe('TypeSafe invalid reply reasons', () => {
  const valid = () => buildReply(payload, { 'view/weather-main': 'hide' }, 0.8);
  const scope = () => valid().answers.scope as Record<string, unknown>;
  const withScope = (answer: unknown) => {
    const reply = valid();
    return { ...reply, answers: { ...reply.answers, scope: answer } };
  };

  test.each<[string, Step, InvalidReplyReason]>([
    ['a non-JSON body', { body: '{not json' }, 'malformed_json'],
    ['an oversized body', 'oversized', 'oversize'],
    [
      'a missing question id',
      { reply: { ...valid(), answers: { scope: scope() } } },
      'missing_answer',
    ],
    [
      'an extra question id',
      {
        reply: { ...valid(), answers: { ...valid().answers, extra: scope() } },
      },
      'key_mismatch',
    ],
    [
      'probabilities that do not sum to one',
      {
        reply: withScope({
          ...scope(),
          probabilities: { supported: 0.9, unsupported: 0.05, ambiguous: 0 },
        }),
      },
      'probability_sum',
    ],
    [
      'a different model',
      { reply: { ...valid(), model: 'other' } },
      'model_echo',
    ],
    [
      'a chosen option without the highest probability',
      {
        reply: withScope({
          ...scope(),
          probabilities: { supported: 0.2, unsupported: 0.8, ambiguous: 0 },
        }),
      },
      'not_most_probable',
    ],
    [
      'a noul answer to a choice question',
      { reply: withScope({ type: 'noul', noul: 0.4 }) },
      'wrong_type',
    ],
    [
      'a confidence outside [0, 1]',
      { reply: withScope({ ...scope(), confidence: 1.5 }) },
      'out_of_range',
    ],
  ])('%s defers provider_invalid_reply with its reason tag', async (_name, step, reason) => {
    const { ask, logger, entries } = setup(() => step);
    const result = await ask('jevActions', evaluation, ctx(logger));
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevActions/provider_invalid_reply',
    });
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data,
    ).toMatchObject({
      reason: 'jevActions/provider_invalid_reply',
      detail: `invalid reply (${reason})`,
      failure: { kind: 'invalid_reply', reason },
    });
  });
});

describe('the TypeSafe key never leaks', () => {
  test.each([
    ['a missing key', { apiKey: '', model: TEST_MODEL }, /apiKey/],
    ['an empty model', { apiKey: KEY, model: '' }, /model/],
    [
      'a bad endpoint',
      { apiKey: KEY, model: TEST_MODEL, endpoint: 'nope' },
      /endpoint/,
    ],
    [
      'a bad fetch',
      { apiKey: KEY, model: TEST_MODEL, fetch: 'nope' as never },
      /fetch/,
    ],
    [
      'a bad timeout',
      { apiKey: KEY, model: TEST_MODEL, timeoutMs: 0 },
      /timeoutMs/,
    ],
    [
      'a bad onCall',
      { apiKey: KEY, model: TEST_MODEL, onCall: 'nope' as never },
      /onCall/,
    ],
    [
      'a bad logReplies',
      { apiKey: KEY, model: TEST_MODEL, logReplies: 'yes' as never },
      /logReplies/,
    ],
  ])('construction rejects %s without echoing the key', (_name, options, pattern) => {
    let caught: unknown;
    try {
      createTypeSafeClient(options as TypeSafeClientOptions);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/^Invalid TypeSafe option: /);
    expect((caught as Error).message).toMatch(pattern);
    expect((caught as Error).message).not.toContain(KEY);
  });

  test('a 401 whose body echoes the key reaches no error, log, instrument attribute or call record', async () => {
    const echoing = (async () =>
      new Response(
        JSON.stringify({
          detail: {
            error_type: 'authentication_error',
            error_code: KEY,
            message: `Invalid API key: ${KEY}`,
          },
        }),
        { status: 401 },
      )) as unknown as typeof fetch;
    const recorded: JevCall[] = [];
    const ask = createTypeSafeClient({
      apiKey: KEY,
      model: TEST_MODEL,
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
    expect(events).toHaveLength(1);
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data
        ?.failure,
    ).toEqual({ kind: 'http', status: 401, errorType: 'authentication_error' });
  });
});
