import { describe, expect, test } from 'bun:test';

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
import { choice, type Evaluation, MAX_CHOICES } from './questions.js';
import {
  type CallOutcome,
  createTypeSafeClient,
  type JevCall,
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

function setup(script: Script, options: { timeoutMs?: number } = {}) {
  const { fetch, calls } = scriptedFetch(script);
  const recorded: JevCall[] = [];
  const ask = createTypeSafeClient({
    apiKey: KEY,
    model: TEST_MODEL,
    fetch,
    timeoutMs: options.timeoutMs ?? 1000,
    onCall: (call) => recorded.push(call),
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
