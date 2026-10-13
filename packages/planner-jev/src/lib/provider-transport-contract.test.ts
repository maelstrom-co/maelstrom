import { describe, expect, test } from 'bun:test';

import type { WireAnswer } from '@tanstack/ai';

import {
  type Step,
  scriptedFetch,
  TEST_MODEL,
} from './__test-helpers__/scripted-fetch.js';
import type {
  ProviderRequest,
  ProviderTransport,
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

interface TransportHarness {
  readonly name: string;
  readonly canRefuse: boolean;
  readonly build: (
    fetch: typeof globalThis.fetch,
    apiKey: string,
  ) => ProviderTransport;
  readonly fetchFor: (step: Step) => typeof globalThis.fetch;
  readonly refusingFetch?: (
    refuse: readonly string[],
  ) => typeof globalThis.fetch;
  readonly request: ProviderRequest;
  readonly requestBody: string;
  readonly usage: Usage;
}

const HARNESSES: TransportHarness[] = [
  {
    name: 'TypeSafe',
    canRefuse: false,
    build: (fetch, apiKey) =>
      typesafeTransport({
        apiKey,
        model: TEST_MODEL,
        endpoint: ENDPOINT,
        fetch,
      }),
    fetchFor: (step) => scriptedFetch(() => step).fetch,
    request,
    requestBody:
      '{"model":"jev-test","state":{"intent":"hide the weather"},"questions":{"scope":{"type":"choice","instructions":"Is it supported?","criteria":{"supported":"yes","unsupported":"no"}},"needsActions":{"type":"noul","instructions":"Does it need actions?"},"satisfied":{"type":"score","instructions":"Did the response do what was asked?","criteria":["Nothing happened","Some of it happened","All of it"]}}}',
    usage: { inputTokens: 11, outputTokens: 2 },
  },
];

const ANSWERING: Step = {
  choices: { scope: 'unsupported' },
  confidence: 0.6,
  nouls: { needsActions: 0.25 },
  scores: { satisfied: 2 },
};

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
  ) => harness.build(fetch, KEY).send(harness.request, signal);

  test('sends exactly the pinned request body', async () => {
    const recorded = recording(harness.fetchFor(ANSWERING));
    await send(recorded.fetch);
    expect(recorded.bodies).toEqual([harness.requestBody]);
    expect(recorded.headers[0]).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    });
  });

  test('decodes a valid reply into wire answers, usage and the raw reply', async () => {
    const fetch = harness.fetchFor(ANSWERING);
    const raw: unknown = await (
      await fetch(ENDPOINT, { method: 'POST', body: harness.requestBody })
    ).json();
    const result = await send(fetch);
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
    const body = JSON.stringify({
      error: {
        message: 'Unrecognized request argument supplied: extra',
        type: 'invalid_request_error',
        code: 'unknown_parameter',
      },
    });
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
    const body = JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'too_long',
        message: 'x'.repeat(64 * 1024),
      },
    });
    const counted = counting(harness.fetchFor({ status: 400, body }));
    expect(await send(counted.fetch)).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400 },
    });
    expect(counted.bytes()).toBeLessThanOrEqual(8 * 1024);
  });

  test.each<[string, Step]>([
    ['a hanging request', 'hang'],
    ['a body that stalls mid-stream', 'stall'],
  ])('%s resolves to a failure soon after the signal aborts', async (_name, step) => {
    const controller = new AbortController();
    const pending = send(harness.fetchFor(step), controller.signal);
    await Bun.sleep(20);
    const aborted = performance.now();
    controller.abort('timeout');
    const result = await pending;
    expect(performance.now() - aborted).toBeLessThan(200);
    expect(result.ok).toBe(false);
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
        body: JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${KEY}`,
            type: KEY,
            code: KEY,
          },
        }),
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
        body: JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${KEY}`,
            type: KEY,
            code: 'invalid_api_key',
          },
        }),
      }),
    );
    expect(benignCode).toEqual({
      ok: false,
      failure: { kind: 'http', status: 401, errorCode: 'invalid_api_key' },
    });
    expect(JSON.stringify(benignCode)).not.toContain(KEY);
  });
});

function recording(inner: typeof fetch) {
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
    return inner(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, bodies, headers };
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
