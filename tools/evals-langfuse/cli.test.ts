import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EvaluationResult } from '../../packages/evals/src/core/runtime/evaluate.js';
import { runLangfuseCli } from './cli.ts';
import { type LangfuseV3Transport, startLangfuseV3Sink } from './sink.js';

const identity = {
  runId: 'PRIVATE RUN',
  caseId: 'PRIVATE CASE',
  runtimeId: 'synthetic',
  sample: 1,
};
const sampleKey = JSON.stringify(Object.values(identity));
function result(): EvaluationResult<unknown> {
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
    observation: 'PRIVATE OBSERVATION',
    records: [
      {
        sampleKey,
        sequence: 0,
        kind: 'turn',
        value: 'PRIVATE RECORD',
        producer: 'PRIVATE PRODUCER',
        requestId: 'PRIVATE REQUEST',
      },
    ],
  };
}
let directory: string;
let input: string;
let previewNumber: number;
let credentialReads: string[];
let starts: number;
let batches: Parameters<LangfuseV3Transport['batch']>[0][];
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

function args(overrides: Record<string, string> = {}) {
  return Object.entries({
    input,
    destination: 'synthetic-destination',
    artifact: 'summary',
    'prepared-at': '2026-10-27T15:00:00.000Z',
    'base-url': 'https://langfuse.invalid',
    'server-version': '3.163.0',
    'timeout-ms': '1000',
    'shutdown-timeout-ms': '100',
    ...overrides,
  }).map(([key, value]) => `--${key}=${value}`);
}
function dependencies(transport?: LangfuseV3Transport) {
  return {
    nodeVersion: '24.0.0',
    env: new Proxy(
      {
        LANGFUSE_PUBLIC_KEY: 'SECRET PUBLIC',
        LANGFUSE_SECRET_KEY: 'SECRET PRIVATE',
      },
      {
        get(target, key) {
          credentialReads.push(String(key));
          return Reflect.get(target, key);
        },
      },
    ),
    startSink: (config: Parameters<typeof startLangfuseV3Sink>[0]) => {
      starts++;
      expect(config.publicKey).toBe('SECRET PUBLIC');
      expect(config.secretKey).toBe('SECRET PRIVATE');
      return startLangfuseV3Sink(
        config,
        transport ?? {
          async batch(request, options) {
            expect(options.maxRetries).toBe(0);
            batches.push(request);
            return {
              successes: request.batch.map(({ id }) => ({ id, status: 201 })),
              errors: [],
            };
          },
        },
      );
    },
  };
}
async function preview(overrides: Record<string, string> = {}) {
  const path = join(directory, `preview-${previewNumber++}.json`);
  const outcome = await runLangfuseCli(
    [...args(overrides), '--preview-out', path],
    dependencies(),
  );
  expect(outcome.exitCode).toBe(0);
  const json = await readFile(path, 'utf8');
  expect(outcome.output.approvalSha256).toBe(
    createHash('sha256').update(json).digest('hex'),
  );
  return {
    path,
    json,
    outcome,
    approval: String(outcome.output.approvalSha256),
  };
}
function publishArgs(approval: string, overrides: Record<string, string> = {}) {
  return [...args(overrides), '--publish', '--approve-sha256', approval];
}
function expectNoSecrets(value: unknown) {
  const output = JSON.stringify(value);
  for (const text of [
    'PRIVATE',
    'SECRET',
    'langfuse.invalid',
    directory,
    'synthetic-destination',
  ])
    expect(output).not.toContain(text);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evals-langfuse-cli-'));
  input = join(directory, 'result.json');
  await writeFile(input, JSON.stringify(result()));
  previewNumber = 0;
  credentialReads = [];
  starts = 0;
  batches = [];
  const deny = () => {
    throw new Error('NETWORK DENIED');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(async () => {
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

test('preview stores exact summary envelope privately without credentials, SDK startup or raw log data', async () => {
  await writeFile(
    input,
    JSON.stringify({
      ...result(),
      failures: ['PRIVATE FAILURE'],
      error: { phase: 'execution', message: 'PRIVATE ERROR' },
      cleanupError: 'PRIVATE CLEANUP',
    }),
  );
  const { path, json, outcome } = await preview();
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const envelope = JSON.parse(json);
  expect(envelope.sink).toEqual({
    destinationId: 'synthetic-destination',
    baseUrl: 'https://langfuse.invalid',
    serverVersion: '3.163.0',
    timeoutMs: 1000,
    shutdownTimeoutMs: 100,
    maxInFlight: 1,
    maxBatchBytes: 65536,
  });
  expect(envelope.limits).toEqual({
    maxInputBytes: 8 * 1024 * 1024,
    maxPublicationBytes: 16384,
    maxEntries: 1,
  });
  const payload = JSON.parse(envelope.publication.json);
  expect(payload.kind).toBe('summary');
  expect(payload.recording).toBeUndefined();
  expect(payload.evidence).toMatchObject({
    sourceRecordCount: 1,
    omittedRecordCount: 1,
    observation: 'omitted',
  });
  expect(payload).toMatchObject({
    failureCount: 1,
    errorPhase: 'execution',
    cleanupFailed: true,
  });
  expect(envelope.publication.payloadDigest).toBe(
    createHash('sha256').update(envelope.publication.json).digest('hex'),
  );
  for (const raw of [
    'PRIVATE OBSERVATION',
    'PRIVATE RECORD',
    'PRIVATE PRODUCER',
    'PRIVATE REQUEST',
    'PRIVATE FAILURE',
    'PRIVATE ERROR',
    'PRIVATE CLEANUP',
  ])
    expect(json).not.toContain(raw);
  expectNoSecrets(outcome);
});

test('approval re-prepares the reviewed object and publishes exactly once through publisher and sink', async () => {
  const { approval, json } = await preview();
  const response = await runLangfuseCli(publishArgs(approval), dependencies());
  expect(response).toMatchObject({
    exitCode: 0,
    output: {
      mode: 'publish',
      status: 'accepted',
      shutdown: 'closed',
      approvalSha256: approval,
    },
  });
  expect(credentialReads).toEqual([
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
  ]);
  expect(starts).toBe(1);
  expect(batches).toHaveLength(1);
  const span = batches[0].batch.find((event) => event.type === 'span-create');
  expect(span?.body.output).toEqual(
    JSON.parse(JSON.parse(json).publication.json),
  );
  expectNoSecrets(response);
});

test.each([
  ['destination', 'other-destination'],
  ['artifact', 'other-artifact'],
  ['base-url', 'https://other.invalid'],
  ['prepared-at', '2026-10-27T15:01:00.000Z'],
  ['max-batch-bytes', '65537'],
  ['max-publication-bytes', '16385'],
  ['timeout-ms', '1001'],
  ['shutdown-timeout-ms', '101'],
  ['max-in-flight', '2'],
])('approval binds changed %s before credential access', async (flag, value) => {
  const { approval } = await preview();
  expect(
    await runLangfuseCli(
      publishArgs(approval, { [flag]: value }),
      dependencies(),
    ),
  ).toEqual({
    exitCode: 2,
    output: { status: 'invalid', code: 'approval_mismatch' },
  });
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test('changed summary content invalidates approval; omitted raw evidence never becomes a recording', async () => {
  const { approval } = await preview();
  await writeFile(
    input,
    JSON.stringify({ ...result(), observation: 'CHANGED PRIVATE OBSERVATION' }),
  );
  expect((await preview()).approval).toBe(approval);
  await writeFile(
    input,
    JSON.stringify({ ...result(), evaluation: 'fail', failures: ['failure'] }),
  );
  expect(
    (await runLangfuseCli(publishArgs(approval), dependencies())).output.code,
  ).toBe('approval_mismatch');
  expect(credentialReads).toEqual([]);
});

test('payload digest and publication ID are not endpoint-bound approval tokens', async () => {
  const { outcome } = await preview();
  for (const token of [
    outcome.output.payloadDigest,
    outcome.output.publicationId,
  ]) {
    expect(
      (await runLangfuseCli(publishArgs(String(token)), dependencies())).output
        .code,
    ).toBe('approval_mismatch');
  }
  expect(credentialReads).toEqual([]);
});

test('manual-report requires explicit extraction and is included in the approval binding', async () => {
  await writeFile(
    input,
    JSON.stringify({ result: result(), extra: 'PRIVATE REPORT' }),
  );
  const bad = await runLangfuseCli(
    [...args(), '--preview-out', join(directory, 'bad.json')],
    dependencies(),
  );
  expect(bad.output.code).toBe('invalid_input');
  const { approval, json } = await preview({ 'input-format': 'manual-report' });
  expect(json).not.toContain('PRIVATE REPORT');
  expect(
    (
      await runLangfuseCli(
        publishArgs(approval, { 'input-format': 'manual-report' }),
        dependencies(),
      )
    ).exitCode,
  ).toBe(0);
});

test.each([
  ['server-version', '4.0.0'],
  ['base-url', 'https://user:SECRET@langfuse.invalid'],
  ['base-url', 'https://langfuse.invalid?SECRET'],
  ['base-url', 'https://langfuse.invalid#SECRET'],
  ['base-url', 'file:///PRIVATE'],
  ['base-url', 'https://langfuse.invalid\n'],
  ['destination', ' '],
  ['max-batch-bytes', '3500001'],
  ['max-batch-bytes', '1'],
  ['max-publication-bytes', '65537'],
  ['timeout-ms', '0'],
  ['timeout-ms', '300001'],
  ['timeout-ms', '1.5'],
  ['timeout-ms', '1e3'],
  ['shutdown-timeout-ms', '60001'],
  ['max-in-flight', '17'],
  ['max-in-flight', '-1'],
])('invalid %s configuration fails before credential access', async (flag, value) => {
  const { approval } = await preview();
  const response = await runLangfuseCli(
    publishArgs(approval, { [flag]: value }),
    dependencies(),
  );
  expect(response.exitCode).toBe(2);
  expect(response.output.code).toBe('invalid_configuration');
  expectNoSecrets(response);
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test('publish requires explicit approval; preview cannot accidentally publish, overwrite or follow output symlinks', async () => {
  const { path, json } = await preview();
  for (const suffix of [
    [],
    ['--publish'],
    ['--approve-sha256', 'a'.repeat(64)],
    ['--publish', '--approve-sha256', 'a'.repeat(64), '--preview-out', path],
    ['--preview-out', path, '--yes'],
    ['--preview-out', path, '--destination', 'duplicate'],
    ['--recording', 'PRIVATE'],
  ]) {
    expect(
      (await runLangfuseCli([...args(), ...suffix], dependencies())).exitCode,
    ).toBe(2);
  }
  expect(
    (await runLangfuseCli([...args(), '--preview-out', path], dependencies()))
      .output.code,
  ).toBe('preview_write_failed');
  expect(await readFile(path, 'utf8')).toBe(json);
  const link = join(directory, 'preview-link.json');
  await symlink(input, link);
  expect(
    (await runLangfuseCli([...args(), '--preview-out', link], dependencies()))
      .exitCode,
  ).toBe(2);
  expect(JSON.parse(await readFile(input, 'utf8'))).toEqual(result());
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test.each(
  [
    null,
    [],
    {},
    { result: result() },
    { ...result(), schemaVersion: 2 },
    { ...result(), sampleKey: 'PRIVATE WRONG KEY' },
    { ...result(), failures: [1] },
    { ...result(), records: [null] },
    { ...result(), records: [{ ...result().records[0], sampleKey: 'wrong' }] },
    { ...result(), error: null },
    { ...result(), cleanupError: {} },
    { ...result(), evaluation: 'success' },
  ].map((value) => [value]),
)('malformed result %# is rejected without echoing its values', async (value) => {
  await writeFile(input, JSON.stringify(value));
  const response = await runLangfuseCli(
    publishArgs('a'.repeat(64)),
    dependencies(),
  );
  expect(response).toEqual({
    exitCode: 2,
    output: { status: 'invalid', code: 'invalid_input' },
  });
  expect(credentialReads).toEqual([]);
});

test('bounded regular-file UTF-8 JSON input only, with no input-path or parser-error logging', async () => {
  for (const value of [
    'PRIVATE {broken json',
    'x'.repeat(8 * 1024 * 1024 + 1),
    Buffer.from([0xff]),
  ]) {
    await writeFile(input, value);
    const response = await runLangfuseCli(
      publishArgs('a'.repeat(64)),
      dependencies(),
    );
    expect(response.output.code).toBe('invalid_input');
    expectNoSecrets(response);
  }
  for (const path of [directory, join(directory, 'PRIVATE MISSING')]) {
    expect(
      (
        await runLangfuseCli(
          publishArgs('a'.repeat(64), { input: path }),
          dependencies(),
        )
      ).output.code,
    ).toBe('invalid_input');
  }
  expect(credentialReads).toEqual([]);
});

test('unsupported Node, help, and invalid date never access credentials', async () => {
  expect(
    (await runLangfuseCli(args(), { ...dependencies(), nodeVersion: '22.0.0' }))
      .output.code,
  ).toBe('unsupported_runtime');
  expect((await runLangfuseCli(['--help'], dependencies())).exitCode).toBe(0);
  expect(
    (
      await runLangfuseCli(
        publishArgs('a'.repeat(64), {
          'prepared-at': '2026-02-30T15:00:00.000Z',
        }),
        dependencies(),
      )
    ).exitCode,
  ).toBe(2);
  expect(credentialReads).toEqual([]);
});

test('missing credentials and startup exceptions are sanitized', async () => {
  const { approval } = await preview();
  const noCredentials = await runLangfuseCli(publishArgs(approval), {
    ...dependencies(),
    env: {},
  });
  expect(noCredentials.output.code).toBe('invalid_credentials');
  expect(starts).toBe(0);
  const broken = await runLangfuseCli(publishArgs(approval), {
    ...dependencies(),
    startSink: () => {
      throw new Error('SECRET PRIVATE SDK ERROR');
    },
  });
  expect(broken.output.code).toBe('sink_initialization_failed');
  expectNoSecrets(broken);
});

test.each([
  'failed',
  'partial',
  'uncertain',
  'throw',
] as const)('fake SDK %s is sanitized, sent once without retries and shut down', async (kind) => {
  const { approval } = await preview();
  let calls = 0;
  const response = await runLangfuseCli(
    publishArgs(approval),
    dependencies({
      async batch(request, options) {
        calls++;
        expect(options.maxRetries).toBe(0);
        if (kind === 'throw') throw new Error('SECRET SDK ERROR');
        return {
          successes:
            kind === 'partial'
              ? [{ id: request.batch[0].id, status: 201 }]
              : [],
          errors:
            kind === 'failed'
              ? request.batch.map(({ id }) => ({
                  id,
                  status: 400,
                  message: 'SECRET REJECTION',
                }))
              : [],
        };
      },
    }),
  );
  expect(calls).toBe(1);
  expect(response.exitCode).toBe(kind === 'failed' ? 1 : 3);
  expect(response.output.status).toBe(kind === 'throw' ? 'uncertain' : kind);
  expect(response.output.shutdown).toBe('closed');
  expectNoSecrets(response);
});

test('a transport still pending after abort reports uncertain delivery and shutdown', async () => {
  const overrides = { 'timeout-ms': '5', 'shutdown-timeout-ms': '5' };
  const { approval } = await preview(overrides);
  let finish!: (
    value: Awaited<ReturnType<LangfuseV3Transport['batch']>>,
  ) => void;
  let signal: AbortSignal | undefined;
  const response = await runLangfuseCli(
    publishArgs(approval, overrides),
    dependencies({
      batch(_request, options) {
        signal = options.abortSignal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  expect(response).toMatchObject({
    exitCode: 3,
    output: { status: 'uncertain', shutdown: 'uncertain' },
  });
  expect(signal?.aborted).toBe(true);
  finish({ successes: [], errors: [] });
});

test.each([
  'uncertain',
  'throw',
] as const)('accepted delivery with %s shutdown never returns success', async (kind) => {
  const { approval } = await preview();
  let shutdowns = 0;
  const response = await runLangfuseCli(publishArgs(approval), {
    ...dependencies(),
    startSink: () => ({
      async publish() {
        return { status: 'accepted' };
      },
      async shutdown() {
        shutdowns++;
        if (kind === 'throw') throw new Error('SECRET');
        return 'uncertain';
      },
    }),
  });
  expect(response).toMatchObject({
    exitCode: 3,
    output: { status: 'accepted', shutdown: 'uncertain' },
  });
  expect(shutdowns).toBe(1);
  expectNoSecrets(response);
});

test('real Node entry previews with SDK import/network denied, does not load .env, and emits JSON exit codes', async () => {
  const hook = join(directory, 'deny-sdk.mjs');
  await writeFile(
    hook,
    `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { if (specifier.includes('@langfuse/')) throw new Error('SDK MUST NOT LOAD'); return next(specifier, context); } });
globalThis.fetch = () => { throw new Error('NETWORK MUST NOT RUN'); };\n`,
  );
  await writeFile(
    join(directory, '.env'),
    'LANGFUSE_PUBLIC_KEY=SECRET\nLANGFUSE_SECRET_KEY=SECRET\n',
  );
  const path = join(directory, 'node-preview.json');
  const command = ['--import', hook, resolve('tools/evals-langfuse/cli.ts')];
  const options = {
    cwd: directory,
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8' as const,
  };
  const output = JSON.parse(
    execFileSync(
      'node',
      [...command, ...args(), '--preview-out', path],
      options,
    ),
  );
  expect(output.status).toBe('preview');
  expectNoSecrets(output);
  const failed = spawnSync(
    'node',
    [...command, ...publishArgs(output.approvalSha256)],
    options,
  );
  expect(failed.status).toBe(2);
  expect(failed.stderr).toBe('');
  expect(JSON.parse(failed.stdout)).toEqual({
    status: 'invalid',
    code: 'invalid_credentials',
  });
});

test.each([
  true,
  false,
])('standalone SDK startup masks ambient debug and flush controls (debug=%s), then restores them', async (debug) => {
  const { approval } = await preview();
  const hook = join(directory, 'intercept-sdk.mjs');
  await writeFile(
    hook,
    `
const controls = ['LANGFUSE_DEBUG', 'LANGFUSE_LOG_LEVEL', 'LANGFUSE_FLUSH_AT', 'LANGFUSE_FLUSH_INTERVAL'];
const original = controls.map((name) => [name, process.env[name]]);
let sends = 0;
let invalidTransport = false;
globalThis.fetch = async (url, init) => {
  sends++;
  if (String(url) !== 'https://langfuse.invalid/api/public/ingestion' || init?.method !== 'POST') {
    invalidTransport = true;
    throw new Error('UNEXPECTED TRANSPORT');
  }
  const request = JSON.parse(init.body);
  return new Response(JSON.stringify({ successes: request.batch.map(({ id }) => ({ id, status: 201 })), errors: [] }), {
    status: 207, headers: { 'content-type': 'application/json' }
  });
};
process.once('exit', () => {
  if (sends !== 1 || invalidTransport) throw new Error('EXPECTED ONE INTERCEPTED SEND');
  if (original.some(([name, value]) => process.env[name] !== value)) throw new Error('SDK ENVIRONMENT NOT RESTORED');
});
`,
  );
  const response = spawnSync(
    'node',
    [
      '--import',
      hook,
      resolve('tools/evals-langfuse/cli.ts'),
      ...publishArgs(approval),
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        LANGFUSE_PUBLIC_KEY: 'SECRET PUBLIC',
        LANGFUSE_SECRET_KEY: 'SECRET PRIVATE',
        LANGFUSE_LOG_LEVEL: 'DEBUG',
        ...(debug
          ? {
              LANGFUSE_DEBUG: 'true',
              LANGFUSE_FLUSH_AT: 'INVALID FLUSH COUNT',
              LANGFUSE_FLUSH_INTERVAL: 'INVALID FLUSH INTERVAL',
            }
          : {}),
      },
    },
  );
  expect(response.status).toBe(0);
  expect(response.stderr).toBe('');
  expectNoSecrets(response.stdout);
  expect(JSON.parse(response.stdout)).toMatchObject({
    status: 'accepted',
    shutdown: 'closed',
    approvalSha256: approval,
  });
});

test('native Node publishes through the real sink with a borrowed fake transport only', async () => {
  const { approval } = await preview();
  const harness = join(directory, 'fake-publish.mjs');
  await writeFile(
    harness,
    `
import { runLangfuseCli } from ${JSON.stringify(pathToFileURL(resolve('tools/evals-langfuse/cli.ts')).href)};
import { startLangfuseV3Sink } from ${JSON.stringify(pathToFileURL(resolve('tools/evals-langfuse/sink.ts')).href)};
globalThis.fetch = () => { throw new Error('NETWORK MUST NOT RUN'); };
let calls = 0;
const response = await runLangfuseCli(process.argv.slice(2), {
  env: { LANGFUSE_PUBLIC_KEY: 'synthetic-public', LANGFUSE_SECRET_KEY: 'synthetic-secret' },
  startSink: (config) => startLangfuseV3Sink(config, {
    async batch(request, options) {
      if (options.maxRetries !== 0) throw new Error('NO RETRIES');
      calls++;
      return { successes: request.batch.map(({ id }) => ({ id, status: 201 })), errors: [] };
    }
  })
});
if (calls !== 1) throw new Error('EXPECTED SINGLE SEND');
console.log(JSON.stringify(response.output));
process.exitCode = response.exitCode;
`,
  );
  const output = JSON.parse(
    execFileSync('node', [harness, ...publishArgs(approval)], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    }),
  );
  expect(output.status).toBe('accepted');
  expect(output.shutdown).toBe('closed');
  expectNoSecrets(output);
});

function plannerRecord(overrides: Record<string, unknown> = {}) {
  return {
    scenarioId: 'native-case',
    suite: 'vessel',
    arm: 'baseline',
    kind: 'baseline',
    repeat: 1,
    turnMs: 12,
    expectedDeferral: false,
    arrangementRules: false,
    userMessage: 'PRIVATE MESSAGE',
    tree: ['PRIVATE TREE'],
    executionPlan: ['PRIVATE PLAN'],
    stages: ['PRIVATE STAGE'],
    llmCalls: ['PRIVATE LLM'],
    rawOutput: 'PRIVATE RAW',
    grader: { pass: true, reason: 'PRIVATE GRADER' },
    ...overrides,
  };
}
async function fullPlannerInput(
  records = [plannerRecord({ score: { pass: true, failures: [] } })],
) {
  await writeFile(join(directory, 'records.json'), JSON.stringify(records));
  await writeFile(
    join(directory, 'summary.json'),
    JSON.stringify({
      meta: {
        arms: [...new Set(records.map((record) => record.arm))].join(', '),
        repeats: Math.max(
          1,
          ...records.map((record) =>
            Number.isSafeInteger(record.repeat) ? record.repeat : 1,
          ),
        ),
        scenarios: new Set(records.map((record) => record.scenarioId)).size,
        private: 'PRIVATE META',
      },
      summaries: [],
    }),
  );
  return { input: directory, 'input-format': 'full-planner-run' };
}

test('full planner import preserves only native scores, explicit errors and reviewed non-score deferral facts', async () => {
  const variants = [
    { score: { pass: true, failures: [] } },
    { score: { pass: false, failures: ['PRIVATE FAILURE'] } },
    {
      score: { pass: true, failures: [] },
      deferral: { stage: 'PRIVATE STAGE', reason: 'PRIVATE REASON' },
    },
    {
      error: { tag: 'PRIVATE TAG', message: 'PRIVATE ERROR' },
      score: { pass: true, failures: [] },
    },
    { expectedDeferral: true, deferredAsExpected: true },
    {
      expectedDeferral: true,
      deferredAsExpected: false,
      score: { pass: true, failures: [] },
    },
    { expectedDeferral: true },
    {},
    { score: {} },
  ];
  const overrides = await fullPlannerInput(
    variants.map((fields, index) =>
      plannerRecord({ scenarioId: `native-${index}`, ...fields }),
    ),
  );
  const { approval, json, outcome } = await preview(overrides);
  const envelope = JSON.parse(json);
  expect(envelope.schemaVersion).toBe(2);
  expect(envelope.publications).toHaveLength(variants.length);
  expect(envelope.source.runId).toMatch(/^full-planner-[a-f0-9]{64}$/);
  const rawRecords = await readFile(join(directory, 'records.json'));
  const rawSummary = await readFile(join(directory, 'summary.json'));
  const hash = createHash('sha256').update('maelstrom/full-planner-run/v1\0');
  for (const buffer of [rawRecords, rawSummary]) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(buffer.length));
    hash.update(length).update(buffer);
  }
  expect(envelope.source).toEqual({
    runId: `full-planner-${hash.digest('hex')}`,
    recordsDigest: createHash('sha256').update(rawRecords).digest('hex'),
    summaryDigest: createHash('sha256').update(rawSummary).digest('hex'),
    actualRecordCount: variants.length,
    expectedRecordCount: variants.length,
  });
  const payloads = envelope.publications.map((publication: { json: string }) =>
    JSON.parse(publication.json),
  );
  expect(
    payloads.map((payload: { evaluation: string }) => payload.evaluation),
  ).toEqual(['pass', 'fail', 'pass', ...Array(6).fill('unscored')]);
  expect(payloads[3]).toMatchObject({
    execution: 'error',
    errorPhase: 'execution',
    completeness: 'absent',
    disposition: null,
  });
  for (const index of [4, 5, 6, 7, 8])
    expect(payloads[index]).toMatchObject({
      evaluation: 'unscored',
      disposition: null,
      completeness: 'absent',
    });
  expect(payloads[4].metadata).toEqual({
    expectedDeferral: true,
    deferredAsExpected: true,
  });
  expect(payloads[5].metadata).toEqual({
    expectedDeferral: true,
    deferredAsExpected: false,
  });
  expect(payloads[6].metadata).toEqual({ expectedDeferral: true });
  expect(payloads[0]).toMatchObject({
    kind: 'summary',
    identity: {
      runId: envelope.source.runId,
      caseId: 'native-0',
      runtimeId: 'baseline',
      sample: 1,
    },
    metadata: { expectedDeferral: false },
  });
  expect(payloads[0].recording).toBeUndefined();
  expect(json).not.toContain('PRIVATE');
  expectNoSecrets(outcome);
  const published = await runLangfuseCli(
    publishArgs(approval, overrides),
    dependencies(),
  );
  expect(published.exitCode).toBe(0);
  expect(published.output.unsent).toBe(0);
  expect(published.output.receipts).toHaveLength(variants.length);
  expect(batches).toHaveLength(variants.length);
  expect(
    batches.flatMap((batch) =>
      batch.batch
        .filter((event) => event.type === 'score-create')
        .map((event) => event.body.value),
    ),
  ).toEqual([1, 0, 1]);
  expect(
    batches[5].batch.find((event) => event.type === 'span-create')?.body.output,
  ).toMatchObject({
    metadata: { expectedDeferral: true, deferredAsExpected: false },
  });
  expectNoSecrets(published);
});

test.each([
  'records.json',
  'summary.json',
])('exact %s bytes, including omitted fields and whitespace, bind run identity and approval', async (file) => {
  const overrides = await fullPlannerInput();
  const first = await preview(overrides);
  const before = JSON.parse(first.json);
  const path = join(directory, file);
  await writeFile(path, `${await readFile(path, 'utf8')}\n`);
  const changed = await preview(overrides);
  const after = JSON.parse(changed.json);
  expect(after.source.runId).not.toBe(before.source.runId);
  expect(after.publications[0].publicationId).not.toBe(
    before.publications[0].publicationId,
  );
  expect(changed.approval).not.toBe(first.approval);
  expect(
    (
      await runLangfuseCli(
        publishArgs(first.approval, overrides),
        dependencies(),
      )
    ).output.code,
  ).toBe('approval_mismatch');
  if (file === 'records.json') {
    const records = JSON.parse(await readFile(path, 'utf8'));
    records[0].rawOutput = 'CHANGED PRIVATE RAW';
    await writeFile(path, JSON.stringify(records));
  } else {
    const summary = JSON.parse(await readFile(path, 'utf8'));
    summary.meta.private = 'CHANGED PRIVATE META';
    await writeFile(path, JSON.stringify(summary));
  }
  const rawChanged = await preview(overrides);
  expect(rawChanged.approval).not.toBe(changed.approval);
  expect(rawChanged.json).not.toContain('PRIVATE');
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test.each([
  ['destination', 'another'],
  ['base-url', 'https://other.invalid'],
  ['artifact', 'another'],
  ['prepared-at', '2026-10-27T15:00:01.000Z'],
  ['timeout-ms', '1001'],
  ['max-publications', '1001'],
  ['max-input-bytes', '8388609'],
  ['max-preview-bytes', '8388609'],
])('full batch approval binds changed %s', async (flag, value) => {
  const overrides = await fullPlannerInput();
  const { approval } = await preview(overrides);
  expect(
    (
      await runLangfuseCli(
        publishArgs(approval, { ...overrides, [flag]: value }),
        dependencies(),
      )
    ).output.code,
  ).toBe('approval_mismatch');
  expect(credentialReads).toEqual([]);
});

test.each(
  [
    [],
    [plannerRecord(), plannerRecord({ suite: 'different', kind: 'different' })],
    [
      plannerRecord(),
      plannerRecord({ scenarioId: 'second', expectedDeferral: 'true' }),
    ],
    [plannerRecord({ repeat: 0 })],
    [plannerRecord({ score: { pass: 'true' } })],
    [plannerRecord({ deferredAsExpected: null })],
    [plannerRecord({ error: null })],
    [plannerRecord(), plannerRecord({ scenarioId: 'x'.repeat(20_000) })],
  ].map((records) => [records]),
)('entire full batch validates before any credential access or send %#', async (records) => {
  const overrides = await fullPlannerInput(records);
  const response = await runLangfuseCli(
    publishArgs('a'.repeat(64), overrides),
    dependencies(),
  );
  expect(response.output.code).toBe('invalid_input');
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test('full batch count, combined input bytes and preview bytes are bounded independently', async () => {
  const overrides = await fullPlannerInput(
    [1, 2, 3].map((repeat) => plannerRecord({ repeat })),
  );
  const inputBytes =
    (await stat(join(directory, 'records.json'))).size +
    (await stat(join(directory, 'summary.json'))).size;
  for (const [flag, value] of [
    ['max-publications', '2'],
    ['max-input-bytes', String(inputBytes - 1)],
    ['max-preview-bytes', '100'],
  ]) {
    const bounds = { [flag]: value };
    expect(
      (
        await runLangfuseCli(
          publishArgs('a'.repeat(64), { ...overrides, ...bounds }),
          dependencies(),
        )
      ).output.code,
    ).toBe('invalid_input');
  }
  for (const [flag, value] of [
    ['max-publications', '10001'],
    ['max-input-bytes', String(128 * 1024 * 1024 + 1)],
    ['max-preview-bytes', String(64 * 1024 * 1024 + 1)],
  ]) {
    const bounds = { [flag]: value };
    expect(
      (
        await runLangfuseCli(
          publishArgs('a'.repeat(64), { ...overrides, ...bounds }),
          dependencies(),
        )
      ).output.code,
    ).toBe('invalid_configuration');
  }
  expect(credentialReads).toEqual([]);
  const accepted = await preview({
    ...overrides,
    'max-input-bytes': String(inputBytes),
    'max-publications': '3',
  });
  const envelopeBytes = Buffer.byteLength(accepted.json);
  expect(envelopeBytes).toBeGreaterThan(100);
});

test('full import requires both native report files and the native summary shape', async () => {
  const overrides = await fullPlannerInput();
  await rm(join(directory, 'summary.json'));
  expect(
    (
      await runLangfuseCli(
        publishArgs('a'.repeat(64), overrides),
        dependencies(),
      )
    ).output.code,
  ).toBe('invalid_input');
  await writeFile(
    join(directory, 'summary.json'),
    JSON.stringify({ meta: {}, summaries: null }),
  );
  expect(
    (
      await runLangfuseCli(
        publishArgs('a'.repeat(64), overrides),
        dependencies(),
      )
    ).output.code,
  ).toBe('invalid_input');
});

test.each([
  ['missing arms', { repeats: 1, scenarios: 1 }],
  ['missing repeats', { arms: 'baseline', scenarios: 1 }],
  ['missing scenarios', { arms: 'baseline', repeats: 1 }],
  ['array arms', { arms: ['baseline'], repeats: 1, scenarios: 1 }],
  ['empty arms', { arms: '', repeats: 1, scenarios: 1 }],
  ['empty arm entry', { arms: 'baseline, ', repeats: 1, scenarios: 1 }],
  ['duplicate arms', { arms: 'baseline, baseline', repeats: 1, scenarios: 1 }],
  ['zero repeats', { arms: 'baseline', repeats: 0, scenarios: 1 }],
  ['negative repeats', { arms: 'baseline', repeats: -1, scenarios: 1 }],
  ['fractional repeats', { arms: 'baseline', repeats: 1.5, scenarios: 1 }],
  ['string repeats', { arms: 'baseline', repeats: '1', scenarios: 1 }],
  [
    'unsafe repeats',
    { arms: 'baseline', repeats: Number.MAX_SAFE_INTEGER + 1, scenarios: 1 },
  ],
  ['zero scenarios', { arms: 'baseline', repeats: 1, scenarios: 0 }],
  ['negative scenarios', { arms: 'baseline', repeats: 1, scenarios: -1 }],
  ['fractional scenarios', { arms: 'baseline', repeats: 1, scenarios: 1.5 }],
  ['string scenarios', { arms: 'baseline', repeats: 1, scenarios: '1' }],
  [
    'unsafe scenarios',
    { arms: 'baseline', repeats: 1, scenarios: Number.MAX_SAFE_INTEGER + 1 },
  ],
  [
    'unsafe product',
    {
      arms: 'baseline, staged',
      repeats: 1,
      scenarios: Number.MAX_SAFE_INTEGER,
    },
  ],
  ['scenario mismatch', { arms: 'baseline', repeats: 1, scenarios: 2 }],
  ['repeat mismatch', { arms: 'baseline', repeats: 2, scenarios: 1 }],
  ['arm mismatch', { arms: 'baseline, staged', repeats: 1, scenarios: 1 }],
] as const)('native count metadata rejects %s before approval, credentials or send', async (_name, meta) => {
  const overrides = await fullPlannerInput();
  const { approval } = await preview(overrides);
  await writeFile(
    join(directory, 'summary.json'),
    JSON.stringify({ meta, summaries: [] }),
  );
  const path = join(directory, 'invalid-count-preview.json');
  const invalid = {
    exitCode: 2,
    output: { status: 'invalid', code: 'invalid_input' },
  } as const;
  expect(
    await runLangfuseCli(
      [...args(overrides), '--preview-out', path],
      dependencies(),
    ),
  ).toEqual(invalid);
  await expect(stat(path)).rejects.toThrow();
  expect(
    await runLangfuseCli(publishArgs(approval, overrides), dependencies()),
  ).toEqual(invalid);
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
  expect(batches).toHaveLength(0);
});

test('native count metadata rejects excess records instead of approving a matching prefix', async () => {
  const overrides = await fullPlannerInput([
    plannerRecord(),
    plannerRecord({ scenarioId: 'second' }),
  ]);
  const { approval } = await preview(overrides);
  await writeFile(
    join(directory, 'summary.json'),
    JSON.stringify({
      meta: { arms: 'baseline', repeats: 1, scenarios: 1 },
      summaries: [],
    }),
  );
  expect(
    (await runLangfuseCli(publishArgs(approval, overrides), dependencies()))
      .output.code,
  ).toBe('invalid_input');
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test('a matching selected-scenario subset previews both structurally consistent record counts', async () => {
  const records = ['selected-1', 'selected-2'].flatMap((scenarioId) =>
    [1, 2].flatMap((repeat) =>
      ['baseline', 'staged'].map((arm) =>
        plannerRecord({ scenarioId, repeat, arm }),
      ),
    ),
  );
  const overrides = await fullPlannerInput(records);
  const { json, outcome } = await preview(overrides);
  expect(JSON.parse(json).source).toMatchObject({
    actualRecordCount: 8,
    expectedRecordCount: 8,
  });
  expect(outcome.output.publications).toBe(8);
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});

test.each([
  ['accepted', 0, 'accepted', 3],
  ['failed', 1, 'failed', 1],
  ['partial', 3, 'partial', 1],
  ['uncertain', 3, 'uncertain', 1],
  ['accepted,failed', 3, 'partial', 2],
  ['accepted,uncertain', 3, 'partial', 2],
] as const)('sequential full publication %s retains receipts, stops early and reports unsent rows', async (sequence, exitCode, status, count) => {
  const overrides = await fullPlannerInput(
    [1, 2, 3].map((repeat) =>
      plannerRecord({ repeat, score: { pass: true, failures: [] } }),
    ),
  );
  const { approval } = await preview(overrides);
  const statuses = sequence.split(',');
  let calls = 0;
  let active = false;
  const response = await runLangfuseCli(
    publishArgs(approval, overrides),
    dependencies({
      async batch(request, options) {
        expect(active).toBe(false);
        active = true;
        const status = statuses[Math.min(calls++, statuses.length - 1)];
        expect(options.maxRetries).toBe(0);
        await Promise.resolve();
        active = false;
        return {
          successes:
            status === 'accepted'
              ? request.batch.map(({ id }) => ({ id, status: 201 }))
              : status === 'partial'
                ? [{ id: request.batch[0].id, status: 201 }]
                : [],
          errors:
            status === 'failed'
              ? request.batch.map(({ id }) => ({
                  id,
                  status: 400,
                  message: 'SECRET REJECTION',
                }))
              : [],
        };
      },
    }),
  );
  expect(response).toMatchObject({
    exitCode,
    output: { status, shutdown: 'closed', unsent: 3 - count },
  });
  expect(response.output.receipts).toHaveLength(count);
  expect(calls).toBe(count);
  expectNoSecrets(response);
});

test('full import timeout stops subsequent publications and preserves shutdown uncertainty', async () => {
  const overrides = {
    ...(await fullPlannerInput(
      [1, 2, 3].map((repeat) => plannerRecord({ repeat })),
    )),
    'timeout-ms': '5',
    'shutdown-timeout-ms': '5',
  };
  const { approval } = await preview(overrides);
  let finish!: (
    value: Awaited<ReturnType<LangfuseV3Transport['batch']>>,
  ) => void;
  let calls = 0;
  const response = await runLangfuseCli(
    publishArgs(approval, overrides),
    dependencies({
      batch(request) {
        if (++calls === 1)
          return Promise.resolve({
            successes: request.batch.map(({ id }) => ({ id, status: 201 })),
            errors: [],
          });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  expect(response).toMatchObject({
    exitCode: 3,
    output: { status: 'partial', shutdown: 'uncertain', unsent: 1 },
  });
  expect(response.output.receipts).toHaveLength(2);
  expect(calls).toBe(2);
  finish({ successes: [], errors: [] });
});

test('full batch accepted delivery with uncertain shutdown returns exit 3 and complete receipt list', async () => {
  const overrides = await fullPlannerInput(
    [1, 2].map((repeat) => plannerRecord({ repeat })),
  );
  const { approval } = await preview(overrides);
  const response = await runLangfuseCli(publishArgs(approval, overrides), {
    ...dependencies(),
    startSink: () => ({
      async publish() {
        return { status: 'accepted' };
      },
      async shutdown() {
        return 'uncertain';
      },
    }),
  });
  expect(response).toMatchObject({
    exitCode: 3,
    output: { status: 'accepted', shutdown: 'uncertain', unsent: 0 },
  });
  expect(response.output.receipts).toHaveLength(2);
});

test('native Node full-planner directory preview and real-SDK intercepted publication', async () => {
  const overrides = await fullPlannerInput(
    [1, 2].map((repeat) =>
      plannerRecord({ repeat, score: { pass: true, failures: [] } }),
    ),
  );
  const path = join(directory, 'native-batch-preview.json');
  const cli = resolve('tools/evals-langfuse/cli.ts');
  const previewOutput = JSON.parse(
    execFileSync('node', [cli, ...args(overrides), '--preview-out', path], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    }),
  );
  expect(previewOutput.publications).toBe(2);
  const hook = join(directory, 'batch-fetch.mjs');
  await writeFile(
    hook,
    `
let calls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'https://langfuse.invalid/api/public/ingestion') throw new Error('UNEXPECTED SEND');
  calls++;
  const { batch } = JSON.parse(init.body);
  return new Response(JSON.stringify({ successes: batch.map(({ id }) => ({ id, status: 201 })), errors: [] }), { status: 207, headers: { 'content-type': 'application/json' } });
};
process.once('exit', () => { if (calls !== 2) throw new Error('EXPECTED TWO INTERCEPTED SENDS'); });
`,
  );
  const published = spawnSync(
    'node',
    [
      '--import',
      hook,
      cli,
      ...publishArgs(previewOutput.approvalSha256, overrides),
    ],
    {
      env: {
        PATH: process.env.PATH ?? '',
        LANGFUSE_PUBLIC_KEY: 'SECRET PUBLIC',
        LANGFUSE_SECRET_KEY: 'SECRET PRIVATE',
        LANGFUSE_DEBUG: 'true',
      },
      encoding: 'utf8',
    },
  );
  expect(published.status).toBe(0);
  expect(published.stderr).toBe('');
  expectNoSecrets(published.stdout);
  expect(JSON.parse(published.stdout)).toMatchObject({
    status: 'accepted',
    unsent: 0,
    publications: 2,
  });
});

test('full batch preflights later samples against exact mapped transport overhead before sending any', async () => {
  const overrides = {
    ...(await fullPlannerInput([
      plannerRecord(),
      plannerRecord({ scenarioId: 'x'.repeat(3_000) }),
    ])),
    'max-publication-bytes': '8192',
    'max-batch-bytes': '8192',
  };
  const outcome = await runLangfuseCli(
    publishArgs('a'.repeat(64), overrides),
    dependencies(),
  );
  expect(outcome.output.code).toBe('invalid_input');
  expect(credentialReads).toEqual([]);
  expect(starts).toBe(0);
});
