import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { WireAnswer } from '@tanstack/ai';

import {
  type DecisionsRequest,
  type DecisionsStep,
  decisionsPayload,
  scriptedDecisionsFetch,
} from './__test-helpers__/scripted-decisions-fetch.js';
import {
  type Step,
  scriptedFetch,
  TEST_MODEL,
} from './__test-helpers__/scripted-fetch.js';
import { decisionsTransport } from './openai-decisions-client.js';
import type {
  ProviderQuestion,
  ProviderRequest,
  ProviderTransport,
  TransportFailure,
  TransportResult,
} from './provider-call.js';
import type { Usage } from './questions.js';
import { choice, noul, score } from './questions.js';
import { typesafeTransport } from './typesafe-client.js';

/**
 * The contract every provider transport passes before it may back
 * `createProviderCall`. A new transport adds a harness to `HARNESSES`.
 */

const KEY = 'contract-secret-key-value';
const ENDPOINT = 'https://provider.test/v1/evaluate';
const LEVELS = ['Nothing happened', 'Some of it happened', 'All of it'];

const request: ProviderRequest = {
  model: TEST_MODEL,
  state: { intent: 'hide the weather' },
  questions: {
    scope: choice('Is it supported?', { supported: 'yes', unsupported: 'no' }),
    needsActions: noul('Does it need actions?'),
    satisfied: score('Did the response do what was asked?', LEVELS),
  },
};

const recordedDecisions = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      '__test-helpers__/decisions-replies/select-gated.json',
    ),
    'utf8',
  ),
) as { request: DecisionsRequest };
const decodedDecisions = decisionsPayload(recordedDecisions.request);

interface TransportHarness {
  readonly name: string;
  readonly canRefuse: boolean;
  readonly build: (
    fetch: typeof globalThis.fetch,
    apiKey: string,
  ) => ProviderTransport;
  readonly fetchFor: (step: Step) => typeof globalThis.fetch;
  /** An error body in this provider's own shape, holding the given fields. */
  readonly errorBody: (fields: ErrorBodyFields) => unknown;
  readonly refusingFetch?: (
    refuse: readonly string[],
  ) => typeof globalThis.fetch;
  /** A request whose encoding is pinned byte for byte by `pinnedBody`. */
  readonly pinnedRequest: ProviderRequest;
  readonly pinnedBody: string;
  readonly usage: Usage;
}

interface ErrorBodyFields {
  readonly message?: string;
  readonly type?: string;
  readonly code?: string;
}

const HARNESSES: TransportHarness[] = [
  {
    name: 'TypeSafe',
    canRefuse: false,
    build: (fetch, apiKey) =>
      typesafeTransport({
        apiKey,
        endpoint: ENDPOINT,
        fetch,
      }),
    fetchFor: (step) => scriptedFetch(() => step).fetch,
    errorBody: typesafeErrorBody,
    pinnedRequest: request,
    pinnedBody:
      '{"model":"jev-test","state":{"intent":"hide the weather"},"questions":{"scope":{"type":"choice","instructions":"Is it supported?","criteria":{"supported":"yes","unsupported":"no"}},"needsActions":{"type":"noul","instructions":"Does it need actions?"},"satisfied":{"type":"score","instructions":"Did the response do what was asked?","criteria":["Nothing happened","Some of it happened","All of it"]}}}',
    usage: { inputTokens: 11, outputTokens: 2 },
  },
  {
    name: 'Decisions',
    canRefuse: true,
    build: (fetch, apiKey) =>
      decisionsTransport({
        apiKey,
        endpoint: ENDPOINT,
        fetch,
        render: (value) => JSON.stringify(value),
      }),
    fetchFor: (step) => scriptedDecisionsFetch(() => step).fetch,
    errorBody: openaiErrorBody,
    refusingFetch: (refuse) =>
      scriptedDecisionsFetch((): DecisionsStep => ({ ...ANSWERING, refuse }))
        .fetch,
    pinnedRequest: {
      model: recordedDecisions.request.model,
      state: decodedDecisions.state,
      questions: decodedDecisions.questions as unknown as Record<
        string,
        ProviderQuestion
      >,
    },
    pinnedBody: JSON.stringify(recordedDecisions.request),
    usage: { inputTokens: 11, outputTokens: 0 },
  },
];

const ANSWERING = {
  choices: { scope: 'unsupported' },
  confidence: 0.6,
  nouls: { needsActions: 0.25 },
  scores: { satisfied: 2 },
} satisfies Step;

const EXPECTED_ANSWERS: Record<string, WireAnswer> = {
  scope: {
    type: 'choice',
    choice: 'unsupported',
    confidence: 0.6,
    probabilities: { supported: 0, unsupported: 1 },
  },
  needsActions: { type: 'noul', noul: 0.25 },
  satisfied: {
    type: 'score',
    score: 2,
    confidence: 0.6,
    legend: { '0': LEVELS[0], '1': LEVELS[1], '2': LEVELS[2] } as Record<
      string,
      string
    >,
    probabilities: { '0': 0, '1': 0, '2': 1 },
  },
};

describe.each(HARNESSES)('$name transport contract', (harness) => {
  const send = (
    fetch: typeof globalThis.fetch,
    signal: AbortSignal = new AbortController().signal,
  ) => harness.build(fetch, KEY).send(request, signal);

  test('sends exactly the pinned request body', async () => {
    const recorded = recording(harness.fetchFor({ status: 500 }));
    await harness
      .build(recorded.fetch, KEY)
      .send(harness.pinnedRequest, new AbortController().signal);
    expect(recorded.bodies).toEqual([harness.pinnedBody]);
    expect(recorded.headers[0]).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    });
  });

  test('decodes a valid reply into wire answers, usage and the raw reply', async () => {
    const recorded = recording(harness.fetchFor(ANSWERING));
    const result = await send(recorded.fetch);
    const raw: unknown = await recorded.responses[0]?.json();
    expect(result).toEqual({
      ok: true,
      reply: {
        answers: EXPECTED_ANSWERS,
        refusals: [],
        usage: harness.usage,
        raw,
      },
    });
  });

  if (harness.canRefuse)
    test('a refusal keeps the other answers and the usage', async () => {
      const refusing = harness.refusingFetch;
      if (!refusing) throw new Error(`${harness.name} cannot script a refusal`);
      const result = await send(refusing(['needsActions']));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.reply.refusals).toEqual(['needsActions']);
      expect(result.reply.answers).toEqual({
        scope: EXPECTED_ANSWERS.scope,
        satisfied: EXPECTED_ANSWERS.satisfied,
      } as Record<string, WireAnswer>);
      expect(result.reply.usage).toEqual(harness.usage);
    });
  else
    test('refusal: not applicable, no scripted reply yields a refusal', async () => {
      const steps: Step[] = [
        ANSWERING,
        { choices: {} },
        {
          reply: {
            model: TEST_MODEL,
            answers: {},
            refusals: ['scope'],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      ];
      for (const step of steps) {
        const result = await send(harness.fetchFor(step));
        expect(result.ok && result.reply.refusals).toEqual([]);
      }
    });

  test('a text error body gives the status alone', async () => {
    expect(await send(harness.fetchFor({ status: 500 }))).toEqual({
      ok: false,
      failure: { kind: 'http', status: 500 },
    });
  });

  test('a JSON error body gives its type and code', async () => {
    const body = JSON.stringify(
      harness.errorBody({
        message: 'Unrecognized request argument supplied: extra',
        type: 'invalid_request_error',
        code: 'unknown_parameter',
      }),
    );
    expect(await send(harness.fetchFor({ status: 400, body }))).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 400,
        errorType: 'invalid_request_error',
        errorCode: 'unknown_parameter',
      },
    });
  });

  test('a JSON error body over 4 KB gives the status alone and stops reading at 4 KB', async () => {
    const body = JSON.stringify(
      harness.errorBody({
        type: 'invalid_request_error',
        code: 'too_long',
        message: 'x'.repeat(64 * 1024),
      }),
    );
    const counted = counting(harness.fetchFor({ status: 400, body }));
    expect(await send(counted.fetch)).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400 },
    });
    expect(counted.bytes()).toBeLessThanOrEqual(5 * 1024);
  });

  test('an error body declared over 4 KB gives the status alone without reading it', async () => {
    const body = JSON.stringify(
      harness.errorBody({
        type: 'invalid_request_error',
        code: 'too_long',
        message: 'x'.repeat(64 * 1024),
      }),
    );
    const counted = counting(
      harness.fetchFor({ status: 400, body, declaredLength: true }),
    );
    expect(await send(counted.fetch)).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400 },
    });
    expect(counted.bytes()).toBe(0);
  });

  test.each<[string, Step, TransportFailure]>([
    ['a hanging request', 'hang', { kind: 'network' }],
    ['a body that stalls mid-stream', 'stall', { kind: 'network' }],
    [
      'an error body that stalls mid-stream',
      'stalled-error',
      { kind: 'http', status: 500 },
    ],
  ])('%s resolves to its failure soon after the signal aborts', async (_name, step, expected) => {
    const controller = new AbortController();
    const pending = send(harness.fetchFor(step), controller.signal);
    await Bun.sleep(20);
    controller.abort('timeout');
    expect(await settlesWithin(pending, 1000)).toEqual({
      ok: false,
      failure: expected,
    });
  });

  test('an error body that stalls gives the status alone without waiting for the signal', async () => {
    const result = send(harness.fetchFor('stalled-error'));
    expect(await settlesWithin(result, 1000)).toEqual({
      ok: false,
      failure: { kind: 'http', status: 500 },
    });
  });

  test('a body whose stream fails mid-read is a network failure', async () => {
    expect(await send(harness.fetchFor('reset'))).toEqual({
      ok: false,
      failure: { kind: 'network' },
    });
  });

  test.each<[string, Step]>([
    ['by its declared length', 'oversized'],
    ['while streaming without a declared length', 'oversized-stream'],
  ])('a body over 256 KB %s is oversize', async (_name, step) => {
    expect(await send(harness.fetchFor(step))).toEqual({
      ok: false,
      failure: { kind: 'invalid_reply', reason: 'oversize' },
    });
  });

  test('a non-JSON body is malformed_json without a raw reply', async () => {
    expect(await send(harness.fetchFor({ body: '{not json' }))).toEqual({
      ok: false,
      failure: { kind: 'invalid_reply', reason: 'malformed_json' },
    });
  });

  test('a decode failure after a successful parse carries the raw reply', async () => {
    const reply = { answers: 3, usage: { input_tokens: 1, output_tokens: 1 } };
    expect(await send(harness.fetchFor({ reply }))).toEqual({
      ok: false,
      failure: { kind: 'invalid_reply', reason: 'malformed_json' },
      raw: reply,
    });
  });

  test('a key echoed in a 401 error body never reaches the failure', async () => {
    const everywhere = await send(
      harness.fetchFor({
        status: 401,
        body: JSON.stringify(
          harness.errorBody({
            message: `Incorrect API key provided: ${KEY}`,
            type: KEY,
            code: KEY,
          }),
        ),
      }),
    );
    expect(everywhere).toEqual({
      ok: false,
      failure: { kind: 'http', status: 401 },
    });
    expect(JSON.stringify(everywhere)).not.toContain(KEY);

    const benignCode: TransportResult = await send(
      harness.fetchFor({
        status: 401,
        body: JSON.stringify(
          harness.errorBody({
            message: `Incorrect API key provided: ${KEY}`,
            type: KEY,
            code: 'invalid_api_key',
          }),
        ),
      }),
    );
    expect(benignCode).toEqual({
      ok: false,
      failure: { kind: 'http', status: 401, errorCode: 'invalid_api_key' },
    });
    expect(JSON.stringify(benignCode)).not.toContain(KEY);
  });
});

describe('TypeSafe error bodies', () => {
  const send = (status: number, body: unknown) =>
    typesafeTransport({
      apiKey: KEY,
      endpoint: ENDPOINT,
      fetch: scriptedFetch(() => ({ status, body: JSON.stringify(body) }))
        .fetch,
    }).send(request, new AbortController().signal);

  test('a 401 in the live TypeSafe shape gives its error type', async () => {
    expect(
      await send(401, {
        detail: {
          error_type: 'authentication_error',
          message: 'Invalid API key',
        },
      }),
    ).toEqual({
      ok: false,
      failure: { kind: 'http', status: 401, errorType: 'authentication_error' },
    });
  });

  test('a key in the error type and message is dropped', async () => {
    const result = await send(401, {
      detail: {
        error_type: KEY,
        message: `Invalid API key: ${KEY}`,
      },
    });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'http', status: 401 },
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  test.each<[string, unknown]>([
    [
      'the OpenAI shape',
      { error: { type: 'invalid_request_error', code: 'unknown_parameter' } },
    ],
    [
      'top-level fields',
      { type: 'invalid_request_error', code: 'unknown_parameter' },
    ],
  ])('an error body in %s gives the status alone', async (_name, body) => {
    expect(await send(400, body)).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400 },
    });
  });
});

function typesafeErrorBody({ message, type, code }: ErrorBodyFields) {
  return { detail: { error_type: type, error_code: code, message } };
}

function openaiErrorBody({ message, type, code }: ErrorBodyFields) {
  return { error: { message, type, code } };
}

async function settlesWithin<T>(
  pending: Promise<T>,
  ms: number,
): Promise<T | 'still pending'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'still pending'>((resolve) => {
    timer = setTimeout(() => resolve('still pending'), ms);
  });
  try {
    return await Promise.race([pending, late]);
  } finally {
    clearTimeout(timer);
  }
}

function recording(inner: typeof fetch) {
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  const responses: Response[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
    const response = await inner(url, init);
    responses.push(response.clone() as Response);
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, bodies, headers, responses };
}

function counting(inner: typeof fetch) {
  let bytes = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const response = await inner(url, init);
    if (!response.body) return response;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  }) as typeof globalThis.fetch;
  return { fetch, bytes: () => bytes };
}
