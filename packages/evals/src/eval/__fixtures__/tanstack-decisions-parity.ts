import assert from 'node:assert/strict';
import {
  boolean,
  choice,
  decide,
  EVALUATE_REFUSAL_CODE,
  EvaluateError,
  score,
} from '@tanstack/ai';
import { createOpenaiDecider } from '@tanstack/ai-openai';

let unexpectedNetwork = 0;
function forbidNetwork(): never {
  unexpectedNetwork++;
  throw new Error('Unexpected network request in adapter audit.');
}
globalThis.fetch = Object.assign(async () => forbidNetwork(), {
  preconnect: forbidNetwork,
});

type AdapterConfig = NonNullable<Parameters<typeof createOpenaiDecider>[2]>;

function setup(
  response:
    | unknown
    | ((request: Request, attempt: number) => Response | Promise<Response>),
  config: AdapterConfig = {},
) {
  const requests: { url: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? new Request(input, init)
          : new Request(String(input), init);
      if (request.url !== 'https://adapter-audit.invalid/v1/decisions')
        return forbidNetwork();
      requests.push({ url: request.url, body: await request.json() });
      return typeof response === 'function'
        ? response(request, requests.length)
        : Response.json(response);
    },
    { preconnect: forbidNetwork },
  );
  const adapter = createOpenaiDecider('gpt-6-luna', 'offline-placeholder', {
    baseURL: 'https://adapter-audit.invalid/v1',
    maxRetries: 0,
    fetch,
    ...config,
  });
  return { adapter, requests };
}

const questions = {
  queue: choice({
    instructions: 'Select the fixture queue.',
    options: { billing: 'Payments', tech: 'Technical support' },
  }),
};

const answer = {
  name: 'queue',
  type: 'choice',
  choice: 'billing',
  confidence: 0.8,
  probabilities: [
    { value: 'billing', probability: 0.8 },
    { value: 'tech', probability: 0.2 },
  ],
};

function reply(answers: unknown[] = [answer]) {
  return {
    id: 'decision-audit',
    model: 'gpt-6-luna',
    answers,
    usage: { input_tokens: 11, output_tokens: 0, total_tokens: 11 },
  };
}

async function duplicateAnswers() {
  const { adapter, requests } = setup(
    reply([
      answer,
      {
        ...answer,
        choice: 'tech',
        confidence: 0.9,
        probabilities: [
          { value: 'billing', probability: 0.1 },
          { value: 'tech', probability: 0.9 },
        ],
      },
    ]),
  );
  const result = await decide({
    adapter,
    questions,
    state: 'Offline fixture.',
    debug: false,
  });
  assert.equal(result.queue.value, 'tech');
  assert.deepEqual(result.queue.probabilities, { billing: 0.1, tech: 0.9 });
  assert.equal(Object.hasOwn(result, 'raw'), false);
  assert.equal(Object.hasOwn(result.meta, 'raw'), false);
  assert.equal(requests.length, 1);
}

async function duplicateProbabilities() {
  const { adapter } = setup(
    reply([
      {
        ...answer,
        probabilities: [
          ...answer.probabilities,
          { value: 'billing', probability: 0.1 },
        ],
      },
    ]),
  );
  const result = await decide({
    adapter,
    questions,
    state: 'Offline fixture.',
    debug: false,
  });
  assert.equal(result.queue.value, 'billing');
  assert.equal(result.queue.probability, 0.1);
  assert.deepEqual(result.queue.probabilities, { billing: 0.1, tech: 0.2 });
}

async function invalidProbabilities() {
  const cases = [
    { label: 'outside range', probabilities: { billing: 1.2, tech: -0.2 } },
    { label: 'wrong sum', probabilities: { billing: 0.8, tech: 0.1 } },
    { label: 'not most probable', probabilities: { billing: 0.2, tech: 0.8 } },
    { label: 'missing option', probabilities: { billing: 1 } },
  ];
  for (const entry of cases) {
    const { adapter } = setup(
      reply([
        {
          ...answer,
          probabilities: Object.entries(entry.probabilities).map(
            ([value, probability]) => ({ value, probability }),
          ),
        },
      ]),
    );
    const result = await decide({
      adapter,
      questions,
      state: 'Offline fixture.',
      debug: false,
    });
    assert.equal(result.queue.value, 'billing', entry.label);
    assert.deepEqual(
      result.queue.probabilities,
      entry.probabilities,
      entry.label,
    );
  }
  const { adapter } = setup(
    reply([{ name: 'allowed', type: 'predicate', probability: 1.2 }]),
  );
  const result = await decide({
    adapter,
    questions: { allowed: boolean({ instructions: 'Is this allowed?' }) },
    state: 'Offline fixture.',
    debug: false,
  });
  assert.deepEqual(result.allowed, {
    type: 'boolean',
    value: true,
    probability: 1.2,
  });
}

async function scoreEncoding() {
  const { adapter, requests } = setup(
    reply([
      {
        name: 'size',
        type: 'score',
        score: 0.4,
        confidence: 0.8,
        probabilities: [
          { value: 0, label: 'Low', probability: 0.1 },
          { value: 1, label: 'Medium', probability: 0.8 },
          { value: 2, label: 'High', probability: 0.1 },
        ],
      },
    ]),
  );
  const result = await decide({
    adapter,
    questions: {
      size: score({
        instructions: 'Rate the fixture.',
        levels: ['Low', 'Medium', 'High'],
      }),
    },
    state: { value: 7 },
    debug: false,
  });
  assert.deepEqual(requests[0]?.body, {
    model: 'gpt-6-luna',
    input: '{"value":7}',
    questions: [
      {
        type: 'score',
        name: 'size',
        instructions: 'Rate the fixture.',
        levels: [{ label: 'Low' }, { label: 'Medium' }, { label: 'High' }],
      },
    ],
  });
  assert.equal(result.size.value, 'Low');
  assert.equal(result.size.probability, 0.1);
  assert.equal(result.size.score, 0.4);
}

async function refusalIdentity() {
  const { adapter } = setup(
    reply([answer, { name: 'blocked', type: 'refusal' }]),
  );
  await assert.rejects(
    decide({
      adapter,
      questions: {
        ...questions,
        blocked: boolean({ instructions: 'Judge the refused fixture.' }),
      },
      state: 'Offline fixture.',
      debug: false,
    }),
    (error: unknown) => {
      assert.ok(error instanceof EvaluateError);
      assert.equal(error.code, EVALUATE_REFUSAL_CODE);
      assert.equal(error.usage?.totalTokens, 11);
      assert.match(error.message, /"blocked"/);
      assert.equal(Object.hasOwn(error, 'refusals'), false);
      assert.equal(Object.hasOwn(error, 'raw'), false);
      assert.equal(error.answers?.queue?.type, 'choice');
      return true;
    },
  );
}

async function modelAndRawReply() {
  const { model: _model, ...withoutModel } = reply();
  for (const entry of [
    {
      body: { ...reply(), model: 'different-model' },
      model: 'different-model',
    },
    { body: withoutModel, model: undefined },
  ]) {
    const { adapter } = setup({
      ...entry.body,
      diagnostic: 'raw-fixture-marker',
    });
    const result = await decide({
      adapter,
      questions,
      state: 'Offline fixture.',
      debug: false,
    });
    assert.equal(result.meta.model, entry.model);
    assert.equal(result.queue.value, 'billing');
    assert.equal(JSON.stringify(result).includes('raw-fixture-marker'), false);
    assert.equal(Object.hasOwn(result.meta, 'id'), false);
  }
}

async function httpFailureAndRetry() {
  for (const maxRetries of [0, undefined]) {
    const { adapter, requests } = setup(
      (_request: Request, attempt: number) =>
        attempt < 3
          ? Response.json(
              {
                error: {
                  message: 'Private provider detail.',
                  type: 'rate_limit_error',
                  code: 'rate_limit_exceeded',
                },
              },
              { status: 429, headers: { 'retry-after-ms': '1' } },
            )
          : Response.json(reply()),
      { maxRetries },
    );
    const run = decide({
      adapter,
      questions,
      state: 'Stable prefix.',
      debug: false,
    });
    if (maxRetries === 0) {
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Private provider detail/);
        assert.ok('status' in error);
        assert.equal(error.status, 429);
        return true;
      });
      assert.equal(requests.length, 1);
    } else {
      assert.equal((await run).queue.value, 'billing');
      assert.equal(requests.length, 3);
      assert.deepEqual(
        requests.map((request) => request.body),
        [requests[0]?.body, requests[0]?.body, requests[0]?.body],
      );
    }
  }
}

async function boundedBodyReads() {
  let bytesRead = 0;
  const padding = 'x'.repeat(300 * 1024);
  const encoded = new TextEncoder().encode(
    JSON.stringify({ ...reply(), padding }),
  );
  const { adapter } = setup(() => {
    let offset = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === encoded.length) return controller.close();
          const chunk = encoded.slice(offset, offset + 16 * 1024);
          offset += chunk.length;
          bytesRead += chunk.length;
          controller.enqueue(chunk);
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const result = await decide({
    adapter,
    questions,
    state: 'Offline fixture.',
    debug: false,
  });
  assert.equal(result.queue.value, 'billing');
  assert.equal(bytesRead, encoded.length);
  assert.ok(bytesRead > 256 * 1024);
}

async function timeoutAndAbort() {
  for (const mode of ['timeout', 'abort'] as const) {
    let started = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = new AbortController();
    const { adapter, requests } = setup(
      (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(new DOMException('Offline request aborted.', 'AbortError'));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
          started();
        }),
      { timeout: mode === 'timeout' ? 20 : 5_000 },
    );
    const run = decide({
      adapter,
      questions,
      state: 'Offline fixture.',
      abortSignal: controller.signal,
      debug: false,
    });
    await ready;
    if (mode === 'abort') controller.abort();
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.constructor.name,
        mode === 'timeout' ? 'APIConnectionTimeoutError' : 'APIUserAbortError',
      );
      assert.equal(
        error.message,
        mode === 'timeout' ? 'Request timed out.' : 'Request was aborted.',
      );
      return true;
    });
    assert.equal(requests.length, 1);
  }
}

const scenarios = {
  'duplicate-answers': duplicateAnswers,
  'duplicate-probabilities': duplicateProbabilities,
  'invalid-probabilities': invalidProbabilities,
  'score-encoding': scoreEncoding,
  'refusal-identity': refusalIdentity,
  'model-and-raw-reply': modelAndRawReply,
  'http-failure-and-retry': httpFailureAndRetry,
  'bounded-body-reads': boundedBodyReads,
  'timeout-and-abort': timeoutAndAbort,
};
const scenario = process.argv[2];
assert.ok(scenario && Object.hasOwn(scenarios, scenario));
await scenarios[scenario as keyof typeof scenarios]();
assert.equal(unexpectedNetwork, 0);
console.log(scenario);
