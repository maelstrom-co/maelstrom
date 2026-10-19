import {
  afterEach,
  beforeEach,
  expect,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LangfuseClient } from '@langfuse/client';
import { trace } from '@opentelemetry/api';
import {
  createEvaluationPublisher,
  type PublicationStatus,
  prepareEvaluationPublication,
} from '../../packages/evals/src/core/publication.js';
import {
  type EvaluationResult,
  evaluateSample,
} from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type LangfuseV3Config,
  type LangfuseV3Sink,
  type LangfuseV3Transport,
  startLangfuseV3Sink,
} from './sink.js';

type Request = Parameters<LangfuseV3Transport['batch']>[0];
type Receipt = Awaited<ReturnType<LangfuseV3Transport['batch']>>;
const config: LangfuseV3Config = {
  serverVersion: '3.163.0',
  destinationId: 'synthetic-langfuse',
  baseUrl: 'https://langfuse.invalid',
  publicKey: 'synthetic-public',
  secretKey: 'synthetic-secret',
  maxBatchBytes: 65_536,
  timeoutMs: 1_000,
  shutdownTimeoutMs: 100,
  maxInFlight: 4,
};
const identity = {
  runId: 'test-run',
  caseId: 'test-case',
  runtimeId: 'script',
  sample: 1,
};
const sampleKey = JSON.stringify(Object.values(identity));
function result(
  overrides: Partial<EvaluationResult<unknown>> = {},
): EvaluationResult<unknown> {
  return {
    schemaVersion: 1,
    identity,
    sampleKey,
    surface: 'session',
    provenance: 'synthetic',
    execution: 'completed',
    evaluation: 'pass',
    completeness: 'complete',
    disposition: 'planned',
    failures: [],
    records: [
      {
        sampleKey,
        sequence: 0,
        kind: 'turn',
        value: 'RAW PRIVATE',
        producer: 'PRIVATE ID',
      },
    ],
    observation: 'RAW OBSERVATION',
    ...overrides,
  };
}
function prepare(value = result(), artifactId = 'summary', recording = false) {
  return prepareEvaluationPublication(value, {
    destinationId: config.destinationId,
    artifactId,
    policy: { maxBytes: 16_384, review: () => true },
    ...(recording && {
      recording: { observation: 'reviewed synthetic', records: [] },
    }),
  });
}
function bodyId(event: Request['batch'][number]) {
  if (!('id' in event.body)) throw new Error('Expected an identified event');
  return event.body.id;
}
function accept(request: Request): Receipt {
  return {
    successes: request.batch.map(({ id }) => ({ id, status: 201 })),
    errors: [],
  };
}
const signals: AbortSignal[] = [];
const requests: Request[] = [];
const sinks: LangfuseV3Sink[] = [];
function start(
  transport: LangfuseV3Transport = {
    async batch(request, options) {
      requests.push(structuredClone(request));
      expect(options.maxRetries).toBe(0);
      expect(options.timeoutInSeconds).toBe(1);
      if (options.abortSignal) signals.push(options.abortSignal);
      return accept(request);
    },
  },
  overrides: Partial<LangfuseV3Config> = {},
) {
  const sink = startLangfuseV3Sink({ ...config, ...overrides }, transport);
  sinks.push(sink);
  return sink;
}
function publish(sink: LangfuseV3Sink, publication = prepare()) {
  return sink.publish(publication, new AbortController().signal);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
let sdkFetchAllowed = false;
beforeEach(() => {
  sdkFetchAllowed = false;
  requests.length = 0;
  signals.length = 0;
  const deny = () => {
    throw new Error('NO NETWORK');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(async () => {
  try {
    for (const sink of sinks.splice(0)) await sink.shutdown();
    if (!sdkFetchAllowed) expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test('reviewed summary becomes a private trace, export marker and genuine Boolean score', async () => {
  const sink = start();
  const publication = prepare();
  expect(await publish(sink, publication)).toEqual({ status: 'accepted' });
  const batch = requests[0].batch;
  expect(batch.map(({ type }) => type)).toEqual([
    'trace-create',
    'span-create',
    'score-create',
  ]);
  const [root, span, score] = batch;
  if (root.type !== 'trace-create' || span.type !== 'span-create')
    throw new Error('Expected trace and span');
  expect(root.body).toMatchObject({
    sessionId: identity.runId,
    public: false,
    metadata: {
      ...identity,
      publicationId: publication.publicationId,
      payloadDigest: publication.payloadDigest,
    },
  });
  expect(span.body).toMatchObject({
    traceId: root.body.id,
    output: JSON.parse(publication.json),
    metadata: { timing: 'publication only; not evaluation latency' },
  });
  expect(score.body).toMatchObject({
    traceId: root.body.id,
    observationId: span.body.id,
    dataType: 'BOOLEAN',
    value: 1,
  });
  expect(JSON.stringify(batch)).not.toContain('RAW');
  expect(JSON.stringify(batch)).not.toContain('PRIVATE');
  expect(JSON.stringify(batch)).not.toContain(config.secretKey);
  expect(network).not.toHaveBeenCalled();
});

test('projection content and omissions are preserved, without rebuilding a raw recording', async () => {
  const publication = prepare(result(), 'recording', true);
  expect(await publish(start(), publication)).toEqual({ status: 'accepted' });
  const span = requests[0].batch.find((event) => event.type === 'span-create');
  expect(span?.body.output).toEqual(JSON.parse(publication.json));
  expect(span?.body.output).toMatchObject({
    recording: { observation: 'reviewed synthetic', records: [] },
    evidence: { omittedRecordCount: 1 },
  });
});

test('only complete completed pass/fail produce correctness; N/A, hand-off, errors and missing evidence never become zero', async () => {
  const sink = start();
  const cases: Partial<EvaluationResult<unknown>>[] = [
    { evaluation: 'fail' },
    { evaluation: 'unscored', disposition: 'handed_off' },
    { evaluation: 'not_applicable', disposition: 'not_applicable' },
    {
      execution: 'error',
      evaluation: 'unscored',
      error: { phase: 'execution', message: 'PRIVATE ERROR' },
    },
    {
      evaluation: 'unscored',
      error: { phase: 'scoring', message: 'PRIVATE JUDGE' },
    },
    { completeness: 'partial', evaluation: 'unscored' },
    { completeness: 'absent', evaluation: 'unscored' },
    // Defensively refuse a correctness score for inconsistent imported evidence.
    { execution: 'error', evaluation: 'fail' },
  ];
  for (const [index, overrides] of cases.entries()) {
    await publish(sink, prepare(result(overrides), `artifact-${index}`));
    const scores = requests
      .at(-1)
      ?.batch.filter((event) => event.type === 'score-create');
    expect(scores?.length).toBe(index === 0 ? 1 : 0);
    if (index === 0) expect(scores?.[0].body.value).toBe(0);
  }
  expect(JSON.stringify(requests)).not.toContain('PRIVATE ERROR');
});

test('stable IDs bind destination/sample/artifact/content; repeat export preserves IDs without scheduling evaluation', async () => {
  let executed = 0;
  const finished = await evaluateSample(identity, {
    surface: 'fake',
    provenance: 'synthetic',
    execute: async () => {
      executed++;
      return { disposition: 'planned', completeness: 'complete', value: null };
    },
    score: () => ({ outcome: 'pass', failures: [] }),
  });
  const sink = start();
  const publication = prepare(finished);
  await publish(sink, publication);
  await publish(sink, publication);
  expect(requests[0].batch.map(({ id }) => id)).toEqual(
    requests[1].batch.map(({ id }) => id),
  );
  expect(requests[0].batch.map(bodyId)).toEqual(requests[1].batch.map(bodyId));
  await publish(sink, prepare(finished, 'other-artifact'));
  expect(bodyId(requests[2].batch[0])).not.toBe(bodyId(requests[0].batch[0]));
  expect(executed).toBe(1);
  expect(finished.evaluation).toBe('pass');
});

test('persisted publication produces identical batch bytes through a new sink after the clock advances', async () => {
  try {
    setSystemTime(new Date('2026-10-19T12:34:56.123Z'));
    const publication = prepare();
    const persisted = JSON.stringify(publication);
    const first = start();
    expect(await publish(first, publication)).toEqual({ status: 'accepted' });
    await first.shutdown();
    const bytes = JSON.stringify(requests[0]);

    setSystemTime(new Date('2026-10-20T18:00:00.000Z'));
    const restored = Object.freeze(JSON.parse(persisted));
    expect(await publish(start(), restored)).toEqual({ status: 'accepted' });
    expect(JSON.stringify(requests[1])).toBe(bytes);
    const timestamp = JSON.parse(publication.json).preparedAt;
    expect(timestamp).toBe('2026-10-19T12:34:56.123Z');
    expect(
      requests[1].batch.every((event) => event.timestamp === timestamp),
    ).toBe(true);
    const span = requests[1].batch.find(
      (event) => event.type === 'span-create',
    );
    expect(span?.body.startTime).toBe(timestamp);
    expect(span?.body.endTime).toBe(timestamp);
    const root = requests[1].batch.find(
      (event) => event.type === 'trace-create',
    );
    expect(root?.body.timestamp).toBe(timestamp);
  } finally {
    setSystemTime();
  }
});

test('missing or noncanonical persisted timestamps reject before any send', async () => {
  const sink = start();
  const original = prepare();
  for (const preparedAt of [
    undefined,
    null,
    123,
    'invalid',
    '2026-02-30T12:34:56.000Z',
    '2026-10-19T12:34:56Z',
  ]) {
    const json = JSON.stringify({ ...JSON.parse(original.json), preparedAt });
    const payloadDigest = createHash('sha256').update(json).digest('hex');
    const publicationId = createHash('sha256')
      .update(JSON.stringify([original.publicationKey, payloadDigest]))
      .digest('hex');
    expect(
      await publish(sink, {
        ...original,
        json,
        bytes: Buffer.byteLength(json),
        payloadDigest,
        publicationId,
      }),
    ).toEqual({ status: 'failed' });
  }
  expect(requests).toHaveLength(0);
});

test('per-item responses classify full acceptance, rejection, partial and unknown independently', async () => {
  const receiptCases: [(request: Request) => unknown, PublicationStatus][] = [
    [accept, 'accepted'],
    [
      (r) => ({
        successes: [],
        errors: r.batch.map(({ id }) => ({
          id,
          status: 400,
          message: 'PRIVATE',
        })),
      }),
      'failed',
    ],
    [
      (r) => ({
        successes: accept(r).successes.slice(0, 1),
        errors: r.batch.slice(1).map(({ id }) => ({ id, status: 400 })),
      }),
      'partial',
    ],
    [
      (r) => ({ successes: accept(r).successes.slice(0, 1), errors: [] }),
      'partial',
    ],
    [() => ({ successes: [], errors: [] }), 'uncertain'],
    [
      (r) => ({
        successes: [],
        errors: r.batch.map(({ id }) => ({ id, status: 500 })),
      }),
      'uncertain',
    ],
    [
      (r) => ({
        successes: [],
        errors: r.batch.map(({ id }) => ({ id, status: 429 })),
      }),
      'uncertain',
    ],
    [
      (r) => ({
        successes: accept(r).successes.slice(0, 1),
        errors: [{ id: r.batch[1].id, status: 503 }],
      }),
      'partial',
    ],
    [
      (r) => ({
        successes: accept(r).successes.slice(0, 1),
        errors: [{ id: r.batch[1].id, status: 200 }],
      }),
      'uncertain',
    ],
    [
      (r) => ({
        successes: [],
        errors: [
          { id: r.batch[0].id, status: 503 },
          { id: 'unknown', status: 400 },
        ],
      }),
      'uncertain',
    ],
    [() => undefined, 'uncertain'],
    [
      () => ({ successes: [{ id: 'other', status: 201 }], errors: [] }),
      'uncertain',
    ],
    [
      (r) => ({
        successes: [...accept(r).successes, accept(r).successes[0]],
        errors: [],
      }),
      'uncertain',
    ],
    [
      (r) => ({
        successes: accept(r).successes,
        errors: [{ id: r.batch[0].id, status: 400 }],
      }),
      'uncertain',
    ],
    [
      (r) => ({
        successes: [{ id: r.batch[0].id, status: '201' }],
        errors: [],
      }),
      'uncertain',
    ],
  ];
  for (const [receipt, status] of receiptCases) {
    const sink = start({
      batch: async (request) => receipt(request) as Receipt,
    });
    expect(await publish(sink)).toEqual({ status });
  }
  const throwing = start({
    batch: async () => {
      throw new Error('PRIVATE SDK ERROR');
    },
  });
  expect(await publish(throwing)).toEqual({ status: 'uncertain' });
});

test('limits, destination and digest reject before sending; explicit config never falls back to environment', async () => {
  const sink = start();
  const publication = prepare();
  for (const broken of [
    { ...publication, destinationId: 'elsewhere' },
    { ...publication, payloadDigest: 'bad' },
    { ...publication, publicationId: 'bad' },
    { ...publication, publicationKey: 'bad' },
    { ...publication, bytes: 0 },
    { ...publication, json: `${publication.json} ` },
  ])
    expect(await publish(sink, broken)).toEqual({ status: 'failed' });
  const small = start(undefined, { maxBatchBytes: publication.bytes });
  expect(await publish(small, publication)).toEqual({ status: 'failed' });
  expect(requests).toHaveLength(0);
  for (const overrides of [
    { serverVersion: '4.59.0' },
    { secretKey: '' },
    { publicKey: '' },
    { destinationId: '' },
    { baseUrl: '' },
    { baseUrl: 'file:///tmp/secret' },
    { baseUrl: 'https://user:password@example.invalid' },
    { baseUrl: 'https://example.invalid?secret=something' },
    { maxBatchBytes: 3_500_001 },
    { timeoutMs: 0 },
    { maxInFlight: 0 },
    { shutdownTimeoutMs: 0 },
    { timeoutMs: Number.NaN },
  ])
    expect(() =>
      startLangfuseV3Sink({ ...config, ...overrides } as LangfuseV3Config),
    ).toThrow();
  expect(network).not.toHaveBeenCalled();
});

test('abort and timeout return uncertainty without cancelling an uncooperative transport or overlapping capacity', async () => {
  const gate = deferred<Receipt>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const sink = start(
    {
      batch: (_, options) => {
        calls++;
        signal = options.abortSignal;
        return gate.promise;
      },
    },
    { timeoutMs: 10, shutdownTimeoutMs: 10, maxInFlight: 1 },
  );
  const receipt = await publish(sink);
  expect(receipt.status).toBe('uncertain');
  expect(signal?.aborted).toBe(true);
  expect(await publish(sink)).toEqual({ status: 'failed' });
  expect(calls).toBe(1);
  expect(await sink.shutdown()).toBe('uncertain');
  gate.reject(new Error('late private failure'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(receipt).toEqual({ status: 'uncertain' });
  expect(await publish(sink)).toEqual({ status: 'failed' });
});

test('external abort and shutdown are bounded, idempotent and never dispose borrowed resources', async () => {
  const gate = deferred<Receipt>();
  let abort: AbortSignal | undefined;
  let stopped = 0;
  const transport = {
    batch: (
      _: Request,
      options: Parameters<LangfuseV3Transport['batch']>[1],
    ) => {
      abort = options.abortSignal;
      return gate.promise;
    },
    shutdown: () => {
      stopped++;
    },
  };
  const sink = start(transport);
  const controller = new AbortController();
  const inFlight = sink.publish(prepare(), controller.signal);
  await Promise.resolve();
  controller.abort();
  expect(await inFlight).toEqual({ status: 'uncertain' });
  expect(abort?.aborted).toBe(true);
  gate.resolve({ successes: [], errors: [] });
  const closing = sink.shutdown();
  expect(sink.shutdown()).toBe(closing);
  expect(await closing).toBe('closed');
  expect(stopped).toBe(0);
  expect(await publish(sink)).toEqual({ status: 'failed' });
  const preAborted = start();
  expect(await preAborted.publish(prepare(), AbortSignal.abort())).toEqual({
    status: 'failed',
  });
  expect(requests).toHaveLength(0);
});

test('generic publisher can explicitly retry a partial batch, coalesce acceptance and preserve the eval result', async () => {
  const sent: Request[] = [];
  const sink = start({
    batch: async (r) => {
      sent.push(r);
      return sent.length === 1
        ? { successes: accept(r).successes.slice(0, 1), errors: [] }
        : accept(r);
    },
  });
  const publisher = createEvaluationPublisher({
    destinationId: config.destinationId,
    sink,
    timeoutMs: 100,
    maxEntries: 4,
  });
  const publication = prepare();
  expect((await publisher.publish(publication)).status).toBe('partial');
  expect((await publisher.publish(publication)).status).toBe('accepted');
  expect((await publisher.publish(publication)).status).toBe('accepted');
  expect(sent).toHaveLength(2);
  expect(sent[0].batch.map(({ id }) => id)).toEqual(
    sent[1].batch.map(({ id }) => id),
  );
});

test('real pinned SDK sends the public v3 batch endpoint through mocked fetch only, without global OTel or queue flush sends', async () => {
  const beforeProvider = trace.getTracerProvider();
  sdkFetchAllowed = true;
  const sdkRequests: Request[] = [];
  network.mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(String(input)).toBe(`${config.baseUrl}/api/public/ingestion`);
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body as string) as Request;
        sdkRequests.push(body);
        return new Response(JSON.stringify(accept(body)), {
          status: 207,
          headers: { 'content-type': 'application/json' },
        });
      },
      { preconnect: () => {} },
    ),
  );
  const shutdown = spyOn(LangfuseClient.prototype, 'shutdown');
  try {
    const sink = startLangfuseV3Sink(config);
    expect(network).not.toHaveBeenCalled();
    expect(trace.getTracerProvider()).toBe(beforeProvider);
    expect(await publish(sink)).toEqual({ status: 'accepted' });
    expect(sdkRequests).toHaveLength(1);
    expect(await sink.shutdown()).toBe('closed');
    expect(await sink.shutdown()).toBe('closed');
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(sdkRequests).toHaveLength(1);
    expect(trace.getTracerProvider()).toBe(beforeProvider);
  } finally {
    shutdown.mockRestore();
  }
});

test('core remains SDK-independent and all installed Langfuse packages are pinned to 5.13.1', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../../packages/evals/package.json', import.meta.url),
      'utf8',
    ),
  );
  expect(manifest.engines.node).toBe('>=20');
  expect(
    Object.keys(manifest.dependencies).some((name) =>
      name.startsWith('@langfuse/'),
    ),
  ).toBe(false);
  const lock = readFileSync(new URL('../../bun.lock', import.meta.url), 'utf8');
  const versions = [
    ...lock.matchAll(
      /"@langfuse\/(?:client|core|tracing)": \["@langfuse\/[^@]+@([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  expect(versions).toEqual(['5.13.1', '5.13.1', '5.13.1']);
});
