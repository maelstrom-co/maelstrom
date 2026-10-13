import { describe, expect, test } from 'bun:test';

import type { Instrument, InstrumentAttributes } from '@maelstrom-co/engine';
import { isErr, isOk } from '@maelstrom-co/protocol';
import type { WireAnswer, WireQuestion } from '@tanstack/ai';
import {
  makeContext,
  makeInput,
  makeRequest,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import type { AskCall } from './ask.js';
import {
  createProviderCall,
  type ProviderQuestion,
  type ProviderRequest,
  type ProviderTransport,
  type TransportFailure,
  type TransportReply,
  type TransportResult,
} from './provider-call.js';
import {
  choice,
  type Evaluation,
  MAX_CHOICES,
  type Question,
} from './questions.js';

const MODEL = 'jev-test';

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

const validAnswers: Record<string, WireAnswer> = {
  scope: {
    type: 'choice',
    choice: 'supported',
    confidence: 0.7,
    probabilities: { supported: 1, unsupported: 0, ambiguous: 0 },
  },
  'view/weather-main': {
    type: 'choice',
    choice: 'hide',
    confidence: 0.7,
    probabilities: { keep: 0, hide: 1, delete: 0 },
  },
};

const USAGE = { inputTokens: 11, outputTokens: 2 };

type Script = (
  request: ProviderRequest,
  signal: AbortSignal,
) => TransportResult | Promise<TransportResult>;

function replied(
  answers: Record<string, unknown> = validAnswers,
  refusals: readonly string[] = [],
): TransportResult {
  return {
    ok: true,
    reply: {
      answers: answers as TransportReply['answers'],
      refusals,
      usage: USAGE,
      raw: { model: MODEL, answers, refusals },
    },
  };
}

function failure(failure: TransportFailure, raw?: unknown): TransportResult {
  return raw === undefined
    ? { ok: false, failure }
    : { ok: false, failure, raw };
}

function afterAbort(result: TransportResult): Script {
  return (_request, signal) =>
    new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(result), { once: true });
    });
}

function setup(
  script: Script,
  options: { timeoutMs?: number; logReplies?: boolean } = {},
) {
  const sent: { request: ProviderRequest; signal: AbortSignal }[] = [];
  const transport: ProviderTransport = {
    send: async (request, signal) => {
      sent.push({ request, signal });
      return script(request, signal);
    },
  };
  const recorded: AskCall[] = [];
  const ask = createProviderCall({
    label: 'Jev',
    model: MODEL,
    timeoutMs: options.timeoutMs ?? 1000,
    onCall: (call) => recorded.push(call),
    logReplies: options.logReplies ?? false,
    transport,
  });
  const events: { name: string; attributes: InstrumentAttributes }[] = [];
  const instrument: Instrument = {
    stage: (_name, stage) => stage,
    event: (name, attributes) => events.push({ name, attributes }),
  };
  const spy = spyLogger();
  const ctx = (signal?: AbortSignal) =>
    makeContext(makeInput(makeRequest('hide the weather')), {
      logger: spy.logger,
      instrument,
      signal,
    });
  return { ask, sent, recorded, events, ctx, ...spy };
}

describe('createProviderCall before sending', () => {
  test('an over-cap question defers option_cap and never sends', async () => {
    const { ask, sent, recorded, ctx } = setup(() => replied());
    const criteria = Object.fromEntries(
      Array.from({ length: MAX_CHOICES + 1 }, (_, i) => [
        `o${i}`,
        `option ${i}`,
      ]),
    );
    const result = await ask(
      'jevLayout',
      { state: {}, questions: { layout: choice('pick', criteria) } },
      ctx(),
    );
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevLayout/option_cap',
    });
    expect(sent).toHaveLength(0);
    expect(recorded[0]?.outcome).toBe('option_cap');
  });

  test('an already aborted signal never sends', async () => {
    const { ask, sent, recorded, ctx } = setup(() => replied());
    const controller = new AbortController();
    controller.abort('gone');
    const result = await ask('jevSelect', evaluation, ctx(controller.signal));
    expect(isErr(result) && result.error._tag).toBe('CancellationError');
    expect(sent).toHaveLength(0);
    expect(recorded[0]?.outcome).toBe('cancelled');
  });

  test('sends the model, state and questions as they were asked', async () => {
    const { ask, sent, ctx } = setup(() => replied());
    await ask('jevSelect', evaluation, ctx());
    expect(sent[0]?.request).toEqual({
      model: MODEL,
      state: evaluation.state,
      questions: evaluation.questions,
    });
    expect(sent[0]?.request.questions).toBe(evaluation.questions);
  });
});

describe('createProviderCall timeout and cancellation', () => {
  test('a transport that only answers on abort becomes provider_timeout, even with a network failure', async () => {
    const { ask, recorded, entries, ctx } = setup(
      afterAbort(failure({ kind: 'network' })),
      { timeoutMs: 20 },
    );
    const result = await ask('jevLayout', evaluation, ctx());
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevLayout/provider_timeout',
    });
    expect(recorded[0]?.outcome).toBe('provider_timeout');
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data,
    ).toEqual({
      stage: 'jevLayout',
      reason: 'jevLayout/provider_timeout',
      detail: 'no reply within 20 ms',
      failure: { kind: 'network' },
    });
  });

  test('a user abort wins over the timeout and returns a labelled CancellationError', async () => {
    const lingering: Script = async (request, signal) => {
      const result = await afterAbort(failure({ kind: 'network' }))(
        request,
        signal,
      );
      await Bun.sleep(40);
      return result;
    };
    const { ask, recorded, ctx } = setup(lingering, { timeoutMs: 20 });
    const controller = new AbortController();
    const pending = ask('jevSelect', evaluation, ctx(controller.signal));
    await Bun.sleep(5);
    controller.abort('user left');
    const result = await pending;
    expect(isErr(result) && result.error).toMatchObject({
      _tag: 'CancellationError',
      message: 'Jev call cancelled',
      reason: 'user left',
    });
    expect(recorded[0]?.outcome).toBe('cancelled');
  });

  test('the signal the transport gets aborts with the request signal', async () => {
    const { ask, sent, ctx } = setup(afterAbort(failure({ kind: 'network' })));
    const controller = new AbortController();
    const pending = ask('jevSelect', evaluation, ctx(controller.signal));
    await Bun.sleep(5);
    expect(sent[0]?.signal.aborted).toBe(false);
    controller.abort('user left');
    await pending;
    expect(sent[0]?.signal.aborted).toBe(true);
  });

  test('an abort after a valid reply returns the CancellationError', async () => {
    const controller = new AbortController();
    const { ask, recorded, ctx } = setup(() => {
      controller.abort('user left');
      return replied();
    });
    const result = await ask('jevSelect', evaluation, ctx(controller.signal));
    expect(isErr(result) && result.error).toMatchObject({
      _tag: 'CancellationError',
      message: 'Jev call cancelled',
    });
    expect(recorded.map((call) => call.outcome)).toEqual(['cancelled']);
  });
});

describe('createProviderCall reporting', () => {
  test('an ok call logs, emits and records exactly the call keys with usage', async () => {
    const { ask, recorded, events, entries, ctx } = setup(() => replied());
    const result = await ask('jevSelect', evaluation, ctx());
    expect(isOk(result)).toBe(true);

    const call = entries.find((entry) => entry.msg === 'jev.call');
    expect(call?.level).toBe('debug');
    expect(call?.data).toMatchObject({
      stage: 'jevSelect',
      model: MODEL,
      questionIds: ['scope', 'view/weather-main'],
      outcome: 'ok',
      inputTokens: 11,
      outputTokens: 2,
    });
    expect(typeof call?.data?.latencyMs).toBe('number');
    expect(Object.keys(call?.data ?? {}).sort()).toEqual(
      [
        'stage',
        'model',
        'questionIds',
        'latencyMs',
        'outcome',
        'inputTokens',
        'outputTokens',
      ].sort(),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('jev.call');
    const attributes = events[0]?.attributes ?? {};
    expect(attributes).toMatchObject({
      'gen_ai.request.model': MODEL,
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

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      stage: 'jevSelect',
      questionIds: ['scope', 'view/weather-main'],
      outcome: 'ok',
      usage: USAGE,
    });
    expect(Object.keys(recorded[0] ?? {}).sort()).toEqual(
      [
        'stage',
        'questionIds',
        'latencyMs',
        'outcome',
        'usage',
        'answers',
      ].sort(),
    );
  });

  test('a failed call reports no usage and no answers', async () => {
    const { ask, recorded, events, entries, ctx } = setup(() =>
      failure({ kind: 'http', status: 500 }),
    );
    await ask('jevActions', evaluation, ctx());
    const call = entries.find((entry) => entry.msg === 'jev.call');
    expect(call?.data).not.toHaveProperty('inputTokens');
    expect(call?.data).not.toHaveProperty('outputTokens');
    expect(events[0]?.attributes).toMatchObject({
      'maelstrom.stage': 'jevActions',
      'maelstrom.outcome': 'provider_http',
    });
    expect(events[0]?.attributes).not.toHaveProperty(
      'gen_ai.usage.input_tokens',
    );
    expect(events[0]?.attributes).not.toHaveProperty(
      'gen_ai.usage.output_tokens',
    );
    expect(recorded[0]).not.toHaveProperty('usage');
    expect(recorded[0]).not.toHaveProperty('answers');
  });

  test('ok returns the answers without probabilities and onCall gets them with', async () => {
    const { ask, recorded, ctx } = setup(() => replied());
    const result = await ask('jevSelect', evaluation, ctx());
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
    expect(isOk(result) && result.value).toEqual({
      answers: {
        scope: { choice: 'supported', confidence: 0.7 },
        'view/weather-main': { choice: 'hide', confidence: 0.7 },
      },
      usage: USAGE,
    });
  });
});

describe('createProviderCall transport failures', () => {
  test.each<[string, TransportFailure, string, string]>([
    [
      'a network failure',
      { kind: 'network' },
      'provider_network',
      'request failed',
    ],
    [
      'an HTTP failure with parsed fields',
      {
        kind: 'http',
        status: 400,
        errorType: 'invalid_request_error',
        errorCode: 'unknown_parameter',
      },
      'provider_http',
      'HTTP 400 (invalid_request_error, unknown_parameter)',
    ],
    [
      'an HTTP failure with only a code',
      { kind: 'http', status: 401, errorCode: 'invalid_api_key' },
      'provider_http',
      'HTTP 401 (invalid_api_key)',
    ],
    [
      'an HTTP failure with no parsed fields',
      { kind: 'http', status: 500 },
      'provider_http',
      'HTTP 500',
    ],
    [
      'an invalid reply',
      { kind: 'invalid_reply', reason: 'oversize' },
      'provider_invalid_reply',
      'invalid reply (oversize)',
    ],
  ])('%s maps to %s', async (_name, transportFailure, code, detail) => {
    const { ask, recorded, entries, ctx } = setup(() =>
      failure(transportFailure),
    );
    const result = await ask('jevActions', evaluation, ctx());
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: `jevActions/${code}`,
    });
    expect(recorded[0]?.outcome).toBe(code as AskCall['outcome']);
    const warn = entries.find((entry) => entry.msg === 'jev.provider_failure');
    expect(warn?.level).toBe('warn');
    expect(warn?.data).toEqual({
      stage: 'jevActions',
      reason: `jevActions/${code}`,
      detail,
      failure: transportFailure,
    });
    expect(
      entries.find((entry) => entry.msg === 'jev.defer')?.data,
    ).toMatchObject({ stage: 'jevActions', reason: `jevActions/${code}` });
  });

  test('answers that fail validation defer provider_invalid_reply with the reason', async () => {
    const { ask, recorded, entries, ctx } = setup(() =>
      replied({ scope: validAnswers.scope }),
    );
    const result = await ask('jevSelect', evaluation, ctx());
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevSelect/provider_invalid_reply',
    });
    expect(recorded[0]).not.toHaveProperty('usage');
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data,
    ).toEqual({
      stage: 'jevSelect',
      reason: 'jevSelect/provider_invalid_reply',
      detail: 'invalid reply (missing_answer)',
      failure: { kind: 'invalid_reply', reason: 'missing_answer' },
    });
  });

  test('a transport that throws rejects the ask without a deferral', async () => {
    const { ask, recorded, entries, ctx } = setup(() => {
      throw new Error('render failed');
    });
    await expect(ask('jevSelect', evaluation, ctx())).rejects.toThrow(
      'render failed',
    );
    expect(entries.some((entry) => entry.msg === 'jev.defer')).toBe(false);
    expect(recorded).toHaveLength(0);
  });
});

describe('createProviderCall refusals', () => {
  test('a refusal reports usage, warns and defers on the first refused id in question order', async () => {
    const { ask, recorded, events, entries, ctx } = setup(() =>
      replied({ scope: { type: 'choice' } }, ['view/weather-main', 'scope']),
    );
    const result = await ask('jevActions', evaluation, ctx());
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevActions/provider_refusal',
    });
    expect(recorded[0]).toMatchObject({
      outcome: 'provider_refusal',
      usage: USAGE,
    });
    expect(recorded[0]).not.toHaveProperty('answers');
    expect(events[0]?.attributes).toMatchObject({
      'maelstrom.outcome': 'provider_refusal',
      'gen_ai.usage.input_tokens': 11,
    });
    expect(
      entries.find((entry) => entry.msg === 'jev.call')?.data,
    ).toMatchObject({ outcome: 'provider_refusal', inputTokens: 11 });
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data,
    ).toEqual({
      stage: 'jevActions',
      reason: 'jevActions/provider_refusal',
      detail: 'refused scope',
    });
    expect(entries.find((entry) => entry.msg === 'jev.defer')?.data).toEqual({
      stage: 'jevActions',
      reason: 'jevActions/provider_refusal',
      question: 'scope',
    });
  });

  test('a refusal of a question that was not asked is an invalid reply', async () => {
    const { ask, entries, ctx } = setup(() =>
      replied(validAnswers, ['elsewhere']),
    );
    const result = await ask('jevActions', evaluation, ctx());
    expect(isErr(result) && result.error).toEqual({
      _tag: 'Deferred',
      reason: 'jevActions/provider_invalid_reply',
    });
    expect(
      entries.find((entry) => entry.msg === 'jev.provider_failure')?.data,
    ).toMatchObject({
      failure: { kind: 'invalid_reply', reason: 'key_mismatch' },
    });
  });
});

describe('createProviderCall logReplies', () => {
  test('is off by default', async () => {
    const { ask, entries, ctx } = setup(() => replied());
    await ask('jevSelect', evaluation, ctx());
    expect(entries.some((entry) => entry.msg === 'jev.reply')).toBe(false);
  });

  test('logs state, questions and the raw reply as JSON before validation', async () => {
    const { ask, entries, ctx } = setup(
      () => replied({ scope: validAnswers.scope }),
      { logReplies: true },
    );
    await ask('jevSelect', evaluation, ctx());
    const reply = entries.find((entry) => entry.msg === 'jev.reply');
    expect(reply?.level).toBe('debug');
    expect(reply?.data).toEqual({
      stage: 'jevSelect',
      state: JSON.stringify(evaluation.state),
      questions: JSON.stringify(evaluation.questions),
      reply: JSON.stringify({
        model: MODEL,
        answers: { scope: validAnswers.scope },
        refusals: [],
      }),
    });
  });

  test('logs the raw reply of a failure that has one', async () => {
    const { ask, entries, ctx } = setup(
      () =>
        failure(
          { kind: 'invalid_reply', reason: 'model_echo' },
          { model: 'x' },
        ),
      { logReplies: true },
    );
    await ask('jevSelect', evaluation, ctx());
    expect(
      entries.find((entry) => entry.msg === 'jev.reply')?.data?.reply,
    ).toBe(JSON.stringify({ model: 'x' }));
  });

  test('logs nothing for a failure without a raw reply', async () => {
    const { ask, entries, ctx } = setup(
      () => failure({ kind: 'invalid_reply', reason: 'malformed_json' }),
      { logReplies: true },
    );
    await ask('jevSelect', evaluation, ctx());
    expect(entries.some((entry) => entry.msg === 'jev.reply')).toBe(false);
  });
});

describe('provider seam types', () => {
  test('every question is a provider question', () => {
    const question: Assignable<Question, ProviderQuestion> = true;
    const questions: Assignable<
      Evaluation['questions'],
      ProviderRequest['questions']
    > = true;
    expect([question, questions]).toEqual([true, true]);
  });

  test('TanStack wire questions fit the provider question and wire answers match exactly', () => {
    const wireQuestion: Assignable<WireQuestion, ProviderQuestion> = true;
    const toWire: Assignable<TransportReply['answers'][string], WireAnswer> =
      true;
    const fromWire: Assignable<WireAnswer, TransportReply['answers'][string]> =
      true;
    const records: Assignable<
      Record<string, WireAnswer>,
      TransportReply['answers']
    > = true;
    expect([wireQuestion, toWire, fromWire, records]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

type Assignable<From, To> = [From] extends [To] ? true : false;
