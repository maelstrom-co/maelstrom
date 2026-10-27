import {
  afterEach,
  beforeEach,
  expect,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import {
  createEvaluationPublisher,
  type EvaluationPublication,
  type EvaluationResultSink,
  type PublicationStatus,
  prepareEvaluationPublication,
} from './publication.js';
import { type EvaluationResult, evaluateSample } from './runtime/evaluate.js';

const identity = {
  runId: 'synthetic-run',
  caseId: 'synthetic-case',
  runtimeId: 'mock',
  sample: 1,
};
const sampleKey = JSON.stringify(Object.values(identity));
function result(): EvaluationResult<unknown> {
  return {
    schemaVersion: 1,
    identity,
    sampleKey,
    surface: 'mock',
    provenance: 'synthetic',
    execution: 'completed',
    evaluation: 'fail',
    completeness: 'complete',
    disposition: 'planned',
    failures: ['private failure text'],
    error: { phase: 'scoring', message: 'private exception' },
    cleanupError: 'private cleanup',
    observation: { private: 'raw observation' },
    records: [
      {
        sampleKey,
        sequence: 0,
        kind: 'turn',
        value: 'raw turn',
        producer: 'private producer',
        requestId: 'private request',
      },
      { sampleKey, sequence: 1, kind: 'diagnostic', value: 'raw diagnostic' },
    ],
  };
}
const policy = { maxBytes: 4_096, review: () => true };
const preparedAt = '2026-10-19T12:34:56.123Z';
function prepare(value = result(), artifactId = 'summary') {
  return prepareEvaluationPublication(value, {
    destinationId: 'synthetic-one',
    artifactId,
    policy,
    preparedAt,
  });
}
function publisher(
  sink: EvaluationResultSink,
  overrides: { timeoutMs?: number; maxEntries?: number } = {},
) {
  return createEvaluationPublisher({
    destinationId: 'synthetic-one',
    sink,
    timeoutMs: 100,
    maxEntries: 10,
    ...overrides,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('Offline publication test');
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

test('summary allowlists status and counts, omits arbitrary content, and requires review of exact bytes', () => {
  const original = result();
  const before = structuredClone(original);
  let reviewed: EvaluationPublication | undefined;
  const publication = prepareEvaluationPublication(original, {
    destinationId: 'synthetic-one',
    artifactId: 'summary',
    policy: {
      ...policy,
      review: (value) => {
        reviewed = value;
        return true;
      },
    },
  });
  expect(reviewed).toBe(publication);
  expect(Object.isFrozen(publication)).toBe(true);
  expect(publication.bytes).toBe(Buffer.byteLength(publication.json));
  expect(publication.payloadDigest).toBe(
    createHash('sha256').update(publication.json).digest('hex'),
  );
  expect(publication.json).not.toContain('private');
  expect(publication.json).not.toContain('raw');
  expect(JSON.parse(publication.json)).toMatchObject({
    schemaVersion: 1,
    kind: 'summary',
    identity,
    evaluation: 'fail',
    completeness: 'complete',
    failureCount: 1,
    errorPhase: 'scoring',
    cleanupFailed: true,
    evidence: {
      sourceRecordCount: 2,
      omittedRecordCount: 2,
      observation: 'omitted',
    },
  });
  expect(JSON.parse(publication.json).recording).toBeUndefined();
  expect(original).toEqual(before);
});

test('preparation time defaults to current UTC and is validated, canonicalized and content-bound', () => {
  const options = {
    destinationId: 'synthetic-one',
    artifactId: 'summary',
    policy,
  };
  try {
    setSystemTime(new Date(preparedAt));
    const publication = prepareEvaluationPublication(result(), options);
    expect(JSON.parse(publication.json).preparedAt).toBe(preparedAt);
    expect(Object.isFrozen(publication)).toBe(true);
    setSystemTime(new Date('2026-10-20T18:00:00.000Z'));
    expect(JSON.parse(publication.json).preparedAt).toBe(preparedAt);
    expect(
      prepareEvaluationPublication(result(), { ...options, preparedAt }),
    ).toEqual(publication);

    const normalized = prepareEvaluationPublication(result(), {
      ...options,
      preparedAt: '2026-10-19T12:34:56.1Z',
    });
    expect(JSON.parse(normalized.json).preparedAt).toBe(
      '2026-10-19T12:34:56.100Z',
    );
    expect(
      prepareEvaluationPublication(result(), {
        ...options,
        preparedAt: '2026-10-19T12:34:56.100Z',
      }),
    ).toEqual(normalized);
    expect(
      JSON.parse(
        prepareEvaluationPublication(result(), {
          ...options,
          preparedAt: '2026-10-19T12:34:56Z',
        }).json,
      ).preparedAt,
    ).toBe('2026-10-19T12:34:56.000Z');
    expect(normalized.publicationKey).toBe(publication.publicationKey);
    expect(normalized.payloadDigest).not.toBe(publication.payloadDigest);
    expect(normalized.publicationId).not.toBe(publication.publicationId);
  } finally {
    setSystemTime();
  }

  let reviews = 0;
  for (const invalid of [
    '',
    'invalid',
    '2026-10-19',
    '2026-10-19T12:34:56',
    '2026-10-19T12:34:56+02:00',
    '2026-10-19T12:34:56.1234Z',
    '2025-02-29T12:34:56Z',
    '2026-02-30T12:34:56Z',
    '2026-10-19T24:00:00Z',
    '2026-10-19T12:60:00Z',
    null,
    1_000,
    new Date(),
  ]) {
    expect(() =>
      prepareEvaluationPublication(result(), {
        ...options,
        preparedAt: invalid as string,
        policy: {
          ...policy,
          review: () => {
            reviews++;
            return true;
          },
        },
      }),
    ).toThrow('preparation time');
  }
  expect(reviews).toBe(0);
});

test('explicit recording projection snapshots selected values and reports omissions without raw IDs', () => {
  const observation = { safe: true };
  const record = { answer: 'synthetic' };
  const publication = prepareEvaluationPublication(result(), {
    destinationId: 'synthetic-one',
    artifactId: 'recording',
    policy,
    recording: { observation, records: [{ sequence: 1, value: record }] },
  });
  observation.safe = false;
  record.answer = 'mutated';
  const payload = JSON.parse(publication.json);
  expect(payload.kind).toBe('recording');
  expect(payload.recording).toEqual({
    observation: { safe: true },
    records: [
      { sequence: 1, kind: 'diagnostic', value: { answer: 'synthetic' } },
    ],
  });
  expect(payload.evidence).toMatchObject({
    omittedRecordCount: 1,
    observation: 'projected',
  });
  expect(publication.json).not.toContain('private');
  expect(publication.json).not.toContain('raw');
  expect(
    prepare({ ...result(), observation: () => 'not JSON' }).json,
  ).not.toContain('not JSON');
});

test('unsafe, lossy and non-JSON projections reject before review or transport', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  let getterCalls = 0;
  const getter = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get() {
      getterCalls++;
      return 'hidden';
    },
  });
  const symbol = { [Symbol('hidden')]: 'secret' };
  const hidden = Object.defineProperty({}, 'hidden', { value: 'secret' });
  const customArray = Object.assign([1], { extra: 'value' });
  let deep: unknown = null;
  for (let i = 0; i < 35; i++) deep = { nested: deep };
  const invalid = [
    undefined,
    NaN,
    Infinity,
    1n,
    () => 1,
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array([1]),
    circular,
    getter,
    hidden,
    symbol,
    new Array(2),
    customArray,
    deep,
    JSON.parse('{"__proto__":{}}'),
    { toJSON: () => 'unsafe' },
  ];
  let reviews = 0;
  for (const observation of invalid) {
    expect(() =>
      prepareEvaluationPublication(result(), {
        destinationId: 'synthetic-one',
        artifactId: 'recording',
        policy: {
          ...policy,
          review: () => {
            reviews++;
            return true;
          },
        },
        recording: { observation, records: [] },
      }),
    ).toThrow();
  }
  expect(getterCalls).toBe(0);
  expect(reviews).toBe(0);
});

test('oversized arrays reject before key enumeration or descriptor materialization', () => {
  const maxBytes = 64;
  const dense = Array.from({ length: maxBytes + 1 }, () => 0);
  let keysRequested = 0;
  let descriptorsRequested = 0;
  const observation = new Proxy(dense, {
    ownKeys() {
      keysRequested++;
      throw new Error('Must reject before array key enumeration');
    },
    getOwnPropertyDescriptor() {
      descriptorsRequested++;
      throw new Error('Must reject before descriptor materialization');
    },
  });
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'recording',
      policy: { ...policy, maxBytes },
      recording: { observation, records: [] },
    }),
  ).toThrow('byte limit');
  expect(keysRequested).toBe(0);
  expect(descriptorsRequested).toBe(0);
});

test('wide objects reject after key enumeration but before descriptor materialization', () => {
  const maxBytes = 64;
  const wide = Object.fromEntries(
    Array.from({ length: maxBytes + 1 }, (_, index) => [`key${index}`, 0]),
  );
  let keysRequested = 0;
  let descriptorsRequested = 0;
  const observation = new Proxy(wide, {
    ownKeys(target) {
      keysRequested++;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor() {
      descriptorsRequested++;
      throw new Error('Must reject before descriptor materialization');
    },
  });
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'recording',
      policy: { ...policy, maxBytes },
      recording: { observation, records: [] },
    }),
  ).toThrow('byte limit');
  expect(keysRequested).toBe(1);
  expect(descriptorsRequested).toBe(0);
});

test('projection linkage, payload schema, explicit approval and UTF-8 limits fail closed', () => {
  for (const sequences of [[2], [-1], [0, 0], [0.5]]) {
    expect(() =>
      prepareEvaluationPublication(result(), {
        destinationId: 'synthetic-one',
        artifactId: 'recording',
        policy,
        recording: {
          records: sequences.map((sequence) => ({ sequence, value: null })),
        },
      }),
    ).toThrow('projected record sequence');
  }
  expect(() => prepare({ ...result(), sampleKey: 'wrong' })).toThrow(
    'identity',
  );
  expect(() =>
    prepare({
      ...result(),
      schemaVersion: 2,
    } as unknown as EvaluationResult<unknown>),
  ).toThrow('schema');
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'summary',
      policy: { ...policy, review: () => false },
    }),
  ).toThrow('review rejected');
  const publication = prepare(result());
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'summary',
      policy: { ...policy, maxBytes: publication.bytes - 1 },
    }),
  ).toThrow('byte limit');
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'recording',
      policy,
      recording: { observation: '🌦'.repeat(1500), records: [] },
    }),
  ).toThrow('byte limit');
  const absent = result();
  delete (absent as { observation?: unknown }).observation;
  expect(JSON.parse(prepare(absent).json).evidence.observation).toBe('absent');
  expect(() =>
    prepareEvaluationPublication(absent, {
      destinationId: 'synthetic-one',
      artifactId: 'recording',
      policy,
      recording: { observation: null, records: [] },
    }),
  ).toThrow('absent observation');
});

test('canonical keys bind sample, destination, artifact and content independently of object insertion order', () => {
  const make = (observation: unknown, destinationId = 'synthetic-one') =>
    prepareEvaluationPublication(result(), {
      destinationId,
      artifactId: 'recording',
      policy,
      preparedAt,
      recording: { observation, records: [] },
    });
  const first = make({ b: 2, a: 1 });
  expect(make({ a: 1, b: 2 })).toEqual(first);
  const changed = make({ a: 9, b: 2 });
  expect(changed.publicationKey).toBe(first.publicationKey);
  expect(changed.publicationId).not.toBe(first.publicationId);
  expect(changed.payloadDigest).not.toBe(first.payloadDigest);
  const another = make({ b: 2, a: 1 }, 'synthetic-two');
  expect(another.payloadDigest).toBe(first.payloadDigest);
  expect(another.publicationKey).not.toBe(first.publicationKey);
  expect(another.publicationId).not.toBe(first.publicationId);
  expect(prepare(result(), 'another').publicationKey).not.toBe(
    prepare().publicationKey,
  );
});

test('sink acceptance, partial, failed and uncertain are distinct from evaluation; exceptions expose no raw message', async () => {
  const value = result();
  const before = structuredClone(value);
  const publication = prepare(value);
  for (const status of [
    'accepted',
    'partial',
    'failed',
    'uncertain',
  ] as const) {
    const receipt = await publisher({
      publish: async () => ({ status }),
    }).publish(publication);
    expect(receipt).toMatchObject({
      status,
      reason: 'sink',
      publicationId: publication.publicationId,
    });
  }
  const error = await publisher({
    publish: async () => {
      throw new Error('SECRET');
    },
  }).publish(publication);
  expect(error).toMatchObject({ status: 'uncertain', reason: 'sink_error' });
  expect(JSON.stringify(error)).not.toContain('SECRET');
  const invalid = await publisher({
    publish: async () => ({ status: 'queued' as PublicationStatus }),
  }).publish(publication);
  expect(invalid).toMatchObject({
    status: 'uncertain',
    reason: 'invalid_receipt',
  });
  expect(value).toEqual(before);
});

test('concurrent identical publication is coalesced, accepted re-export is reused, and conflicting bytes reject', async () => {
  const gate = deferred<{ status: PublicationStatus }>();
  let sent = 0;
  const target = publisher({
    publish: async () => {
      sent++;
      return gate.promise;
    },
  });
  const publication = prepare();
  const first = target.publish(publication);
  const second = target.publish(prepare());
  await Promise.resolve();
  expect(sent).toBe(1);
  expect(
    await target.publish(prepare({ ...result(), evaluation: 'pass' })),
  ).toMatchObject({ status: 'failed', reason: 'conflict' });
  gate.resolve({ status: 'accepted' });
  expect(await first).toEqual(await second);
  expect(await target.publish(prepare())).toEqual(await first);
  expect(sent).toBe(1);
});

test('timeout is uncertain, requests abort without claiming cancellation, and cannot overlap a still-active send', async () => {
  const gate = deferred<{ status: PublicationStatus }>();
  let signal: AbortSignal | undefined;
  let sends = 0;
  const target = publisher(
    {
      publish: async (_, abort) => {
        sends++;
        signal = abort;
        return gate.promise;
      },
    },
    { timeoutMs: 10 },
  );
  const publication = prepare();
  const receipt = await target.publish(publication);
  expect(receipt).toMatchObject({ status: 'uncertain', reason: 'timeout' });
  expect(signal?.aborted).toBe(true);
  expect(await target.publish(publication)).toMatchObject({
    status: 'uncertain',
    reason: 'in_flight',
  });
  expect(sends).toBe(1);
  gate.resolve({ status: 'accepted' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(receipt).toMatchObject({ status: 'uncertain', reason: 'timeout' });
  // Late success does not rewrite the timeout receipt or assert exactly-once backend delivery.
  expect((await target.publish(publication)).status).toBe('accepted');
  expect(sends).toBe(2);
});

test('late rejection is observed without an unhandled rejection and remains uncertain', async () => {
  const gate = deferred<{ status: PublicationStatus }>();
  const target = publisher({ publish: () => gate.promise }, { timeoutMs: 10 });
  const receipt = await target.publish(prepare());
  gate.reject(new Error('late secret'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(receipt).toMatchObject({ status: 'uncertain', reason: 'timeout' });
});

test('retry reuses finalized evidence, never reruns scoring or execution, and can target a second pluggable sink', async () => {
  let executions = 0;
  let scores = 0;
  let disposed = false;
  const finished = await evaluateSample(identity, {
    surface: 'synthetic',
    provenance: 'mock',
    execute: async () => {
      executions++;
      return {
        completeness: 'complete',
        disposition: 'planned',
        value: { answer: 1 },
      };
    },
    score: () => {
      scores++;
      return { outcome: 'pass', failures: [] };
    },
    dispose: () => {
      disposed = true;
    },
  });
  const publication = prepare(finished);
  const sent: string[] = [];
  const target = publisher({
    publish: async (value) => {
      expect(disposed).toBe(true);
      sent.push(value.publicationId);
      return { status: sent.length === 1 ? 'partial' : 'accepted' };
    },
  });
  expect((await target.publish(publication)).status).toBe('partial');
  expect((await target.publish(publication)).status).toBe('accepted');
  expect(sent).toEqual([publication.publicationId, publication.publicationId]);
  const second = createEvaluationPublisher({
    destinationId: 'synthetic-two',
    timeoutMs: 100,
    maxEntries: 1,
    sink: { publish: async () => ({ status: 'accepted' }) },
  });
  const other = prepareEvaluationPublication(finished, {
    destinationId: 'synthetic-two',
    artifactId: 'summary',
    policy,
  });
  expect((await second.publish(other)).status).toBe('accepted');
  expect(executions).toBe(1);
  expect(scores).toBe(1);
  expect(finished.evaluation).toBe('pass');
});

test('bounded local ledger never evicts conflict protection and refuses unreviewed or wrong-destination bytes', async () => {
  let sends = 0;
  const target = publisher(
    {
      publish: async () => {
        sends++;
        return { status: 'accepted' };
      },
    },
    { maxEntries: 1 },
  );
  const first = prepare();
  await expect(target.publish({ ...first })).rejects.toThrow('reviewed');
  await expect(
    target.publish(
      prepareEvaluationPublication(result(), {
        destinationId: 'elsewhere',
        artifactId: 'summary',
        policy,
      }),
    ),
  ).rejects.toThrow('destination');
  expect((await target.publish(first)).status).toBe('accepted');
  expect(await target.publish(prepare(result(), 'second'))).toMatchObject({
    status: 'failed',
    reason: 'capacity',
  });
  expect(
    await target.publish(prepare({ ...result(), evaluation: 'pass' })),
  ).toMatchObject({ status: 'failed', reason: 'conflict' });
  expect(sends).toBe(1);
  for (const timeoutMs of [0, -1, 1.5, Infinity, 2_147_483_648])
    expect(() =>
      publisher(
        { publish: async () => ({ status: 'accepted' }) },
        { timeoutMs },
      ),
    ).toThrow();
});

test('explicit deferral metadata is detached, reviewed and content-bound without changing the score', () => {
  const metadata = { expectedDeferral: true, deferredAsExpected: false };
  let reviewed: EvaluationPublication | undefined;
  const options = {
    destinationId: 'synthetic-one',
    artifactId: 'summary',
    preparedAt,
    metadata,
    policy: {
      ...policy,
      review(value: EvaluationPublication) {
        reviewed = value;
        return true;
      },
    },
  };
  const publication = prepareEvaluationPublication(result(), options);
  expect(reviewed).toBe(publication);
  expect(JSON.parse(publication.json)).toMatchObject({
    kind: 'summary',
    evaluation: 'fail',
    metadata: { expectedDeferral: true, deferredAsExpected: false },
  });
  metadata.deferredAsExpected = true;
  expect(JSON.parse(publication.json).metadata.deferredAsExpected).toBe(false);
  expect(
    prepareEvaluationPublication(result(), options).publicationId,
  ).not.toBe(publication.publicationId);
  expect(JSON.parse(prepare().json).metadata).toBeUndefined();
});

test.each(
  [
    null,
    [],
    {},
    { expectedDeferral: 'true' },
    { expectedDeferral: true, deferredAsExpected: null },
    { expectedDeferral: false, private: 'raw text' },
    { expectedDeferral: false, toJSON: 'raw text' },
  ].map((value) => [value]),
)('rejects metadata outside the boolean allowlist %# before review', (metadata) => {
  let reviews = 0;
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'summary',
      preparedAt,
      metadata: metadata as Parameters<
        typeof prepareEvaluationPublication
      >[1]['metadata'],
      policy: {
        ...policy,
        review() {
          reviews++;
          return true;
        },
      },
    }),
  ).toThrow();
  expect(reviews).toBe(0);
});

test('publication metadata rejects getters without invoking them', () => {
  let reads = 0;
  expect(() =>
    prepareEvaluationPublication(result(), {
      destinationId: 'synthetic-one',
      artifactId: 'summary',
      preparedAt,
      policy,
      metadata: {
        get expectedDeferral() {
          reads++;
          return true;
        },
      },
    }),
  ).toThrow();
  expect(reads).toBe(0);
});
