import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  type FileHandle,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLangfuseCli } from './cli.ts';
import type { RunLinkClient } from './run-link-publisher.ts';
import {
  evaluatorWarning,
  type RunLinkPlan,
  type RunLinkRequest,
} from './run-links.ts';

let directory: string;
let reads: string[];
let starts: number;
let previewIndex: number;
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
const preparedAt = '2026-10-29T20:52:24.000Z';
function records() {
  return ['baseline', 'jev-poc'].map((arm) => ({
    scenarioId: 'weather',
    suite: 'development',
    kind: arm,
    arm,
    repeat: 1,
    expectedDeferral: false,
    score: { pass: true, failures: [] },
    userMessage: 'PRIVATE PROMPT',
    rawOutput: 'PRIVATE RESPONSE',
    error: { tag: 'PRIVATE TAG', message: 'PRIVATE ERROR' },
    judge: {
      schemaVersion: 1,
      status: 'scored',
      calibration: 'unvalidated',
      provenance: { kind: 'llm', provider: 'typesafe', model: 'jev-1.13.0' },
      rubric: { id: 'planner_response_text_1', version: 2 },
      scores: ['request_satisfied', 'arrangement_match'].map((name) => ({
        name,
        value: 0.8,
        min: 0,
        max: 1,
      })),
    },
  }));
}
async function save(rows = records()) {
  await writeFile(join(directory, 'records.json'), JSON.stringify(rows));
  await writeFile(
    join(directory, 'summary.json'),
    JSON.stringify({
      meta: {
        arms: 'baseline,jev-poc',
        repeats: 1,
        scenarios: new Set(rows.map((row) => row.scenarioId)).size,
      },
      summaries: [],
      private: 'PRIVATE SUMMARY',
    }),
  );
}
function args(overrides: Record<string, string> = {}) {
  return Object.entries({
    input: directory,
    'input-format': 'full-planner-run',
    destination: 'test',
    artifact: 'summary',
    'prepared-at': preparedAt,
    'base-url': 'https://langfuse.invalid',
    'server-version': '3.163.0',
    'timeout-ms': '500',
    'shutdown-timeout-ms': '10',
    ...overrides,
  }).map(([key, value]) => `--${key}=${value}`);
}
function receipt(request: RunLinkRequest, index = 0) {
  return {
    id: `association-${index}`,
    datasetRunId: 'run-1',
    datasetRunName: request.runName,
    datasetItemId: request.datasetItemId,
    traceId: request.traceId,
    observationId: null,
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
  };
}
function dependencies(create?: RunLinkClient['create']) {
  let count = 0;
  return {
    nodeVersion: '24.0.0',
    env: new Proxy(
      {
        LANGFUSE_PUBLIC_KEY: 'SECRET PUBLIC',
        LANGFUSE_SECRET_KEY: 'SECRET PRIVATE',
      },
      {
        get(target, key) {
          reads.push(String(key));
          return Reflect.get(target, key);
        },
      },
    ),
    startSink: () => {
      throw new Error('No trace or dataset upserts allowed');
    },
    startLinkClient: (): RunLinkClient => {
      starts++;
      return {
        create: create ?? (async (request) => receipt(request, count++)),
        async shutdown() {},
      };
    },
  };
}
async function preview(overrides: Record<string, string> = {}, link = true) {
  const path = join(directory, `preview-${previewIndex++}.json`);
  const outcome = await runLangfuseCli(
    [
      ...args(overrides),
      ...(link ? ['--link-only'] : []),
      '--preview-out',
      path,
    ],
    dependencies(),
  );
  expect(outcome.exitCode).toBe(0);
  const json = await readFile(path, 'utf8');
  const approval = createHash('sha256').update(json).digest('hex');
  expect(outcome.output.approvalSha256).toBe(approval);
  return { path, json, approval, plan: JSON.parse(json) as RunLinkPlan };
}
function publishArgs(hash: string, overrides: Record<string, string> = {}) {
  return [
    ...args(overrides),
    '--link-only',
    '--publish',
    '--approve-sha256',
    hash,
    '--confirm-no-active-evaluators',
  ];
}
async function journal(plan: RunLinkPlan) {
  return (await readFile(join(directory, plan.journalFile), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
function sanitized(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE|SECRET|langfuse\.invalid/);
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'run-links-'));
  reads = [];
  starts = 0;
  previewIndex = 0;
  await save();
  const deny = () => {
    throw new Error('Network denied');
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

test('link preview freezes existing item and trace identities with source/recipe/scales and no raw evidence', async () => {
  const catalog = await preview({}, false);
  const result = await preview();
  const next = await preview();
  expect(next.json).toBe(result.json);
  const { plan } = result;
  expect(plan.manifest.catalogApprovalSha256).toBe(catalog.approval);
  expect(plan.manifest.judge).toMatchObject({
    provider: 'typesafe',
    model: 'jev-1.13.0',
    rubric: 'planner_response_text_1',
    rubricVersion: 2,
    calibration: 'unvalidated',
  });
  expect(plan.evaluatorWarning).toBe(evaluatorWarning);
  expect(plan.recoveryPolicy).toContain('No automatic retry');
  expect(plan.requests).toHaveLength(2);
  expect(plan.requests[0].runName).toContain('mixed-arms');
  const original = JSON.parse(catalog.json);
  for (const [i, request] of plan.requests.entries()) {
    expect(request.datasetItemId).toBe(original.dataset.items[i].id);
    expect(request.traceId).toBe(original.dataset.items[i].sourceTraceId);
    expect(request.createdAt).toBe(preparedAt);
    expect(request).not.toHaveProperty('datasetVersion');
    expect(request).not.toHaveProperty('observationId');
    expect(Object.keys(request).sort()).toEqual([
      'createdAt',
      'datasetItemId',
      'metadata',
      'runDescription',
      'runName',
      'traceId',
    ]);
    expect(plan.manifest.samples[i]).toMatchObject({
      caseId: 'weather',
      arm: i === 0 ? 'baseline' : 'jev-poc',
      repeat: 1,
    });
  }
  expect(plan.manifestSha256).toBe(
    createHash('sha256').update(JSON.stringify(plan.manifest)).digest('hex'),
  );
  expect(result.json).not.toMatch(/PRIVATE|SECRET|expectedOutput/);
  expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  expect(
    (await readdir(directory)).some((name) => name.endsWith('.jsonl')),
  ).toBe(false);
  expect(reads).toEqual([]);
  expect(starts).toBe(0);
});

test('link publish sends only reviewed run-item requests, journaling attempts before sends and receipts before next send', async () => {
  const { plan, approval } = await preview();
  const calls: RunLinkRequest[] = [];
  const outcome = await runLangfuseCli(
    publishArgs(approval),
    dependencies(async (request, options) => {
      const entries = await journal(plan);
      expect(entries.at(-1)).toEqual({
        index: calls.length,
        status: 'attempting',
        request,
      });
      if (calls.length) expect(entries.at(-2).status).toBe('accepted');
      expect(entries[0]).toMatchObject({
        approvalSha256: approval,
        manifestSha256: plan.manifestSha256,
      });
      expect(options.maxRetries).toBe(0);
      expect(options.timeoutInSeconds).toBe(0.5);
      expect(options.abortSignal?.aborted).toBe(false);
      calls.push(request);
      return receipt(request, calls.length);
    }),
  );
  expect(calls).toEqual(plan.requests);
  expect(outcome).toMatchObject({
    exitCode: 0,
    output: {
      mode: 'link-publish',
      status: 'accepted',
      attempted: 2,
      accepted: 2,
      unsent: 0,
      shutdown: 'closed',
    },
  });
  expect((await stat(join(directory, plan.journalFile))).mode & 0o777).toBe(
    0o600,
  );
  expect((await journal(plan)).map((x) => x.status)).toEqual([
    'started',
    'attempting',
    'accepted',
    'attempting',
    'accepted',
    'accepted',
  ]);
  sanitized(outcome);
  expect(
    (await runLangfuseCli(publishArgs(approval), dependencies())).output.code,
  ).toBe('run_link_journal_unavailable');
  expect(starts).toBe(1);
});

test.each([
  ['dataset-name', 'other'],
  ['destination', 'other'],
  ['prepared-at', '2026-10-30T00:00:00.000Z'],
  ['base-url', 'https://elsewhere.invalid'],
  ['timeout-ms', '501'],
  ['artifact', 'other'],
])('link approval binds %s before credentials or sends', async (key, value) => {
  const { approval } = await preview();
  expect(
    (
      await runLangfuseCli(
        publishArgs(approval, { [key]: value }),
        dependencies(),
      )
    ).output.code,
  ).toBe('approval_mismatch');
  expect(reads).toEqual([]);
  expect(starts).toBe(0);
});

test('source-byte drift invalidates the frozen evidence manifest, without exporting raw contents', async () => {
  const before = await preview();
  const rows = records();
  rows[0].rawOutput = 'PRIVATE OTHER EVIDENCE';
  await save(rows);
  const after = await preview();
  expect(after.approval).not.toBe(before.approval);
  expect(after.plan.manifest.source.recordsDigest).not.toBe(
    before.plan.manifest.source.recordsDigest,
  );
  expect(
    (await runLangfuseCli(publishArgs(before.approval), dependencies())).output
      .code,
  ).toBe('approval_mismatch');
  expect(after.json).not.toContain('PRIVATE');
  expect(reads).toEqual([]);
});

test('missing evaluator acknowledgement and unsupported judge evidence reject before credentials', async () => {
  const { approval } = await preview();
  expect(
    (
      await runLangfuseCli(
        publishArgs(approval).filter(
          (x) => x !== '--confirm-no-active-evaluators',
        ),
        dependencies(),
      )
    ).output.code,
  ).toBe('evaluator_confirmation_required');
  const rows = records();
  rows[0].judge.provenance.provider = 'openai';
  await save(rows);
  expect(
    (
      await runLangfuseCli(
        [
          ...args(),
          '--link-only',
          '--preview-out',
          join(directory, 'invalid.json'),
        ],
        dependencies(),
      )
    ).output.code,
  ).toBe('invalid_input');
  expect(reads).toEqual([]);
  expect(starts).toBe(0);
});

test('local retry guard survives transport-limit or timestamp changes and symlinks', async () => {
  const original = await preview();
  await symlink(original.path, join(directory, original.plan.journalFile));
  const changes: Record<string, string>[] = [
    { 'timeout-ms': '501' },
    { 'prepared-at': '2026-10-30T00:00:00.000Z' },
  ];
  for (const overrides of changes) {
    const next = await preview(overrides);
    expect(next.plan.journalFile).toBe(original.plan.journalFile);
    expect(
      (
        await runLangfuseCli(
          publishArgs(next.approval, overrides),
          dependencies(),
        )
      ).output.code,
    ).toBe('run_link_journal_unavailable');
  }
  expect(starts).toBe(0);
});

test('concurrent invocations cannot both claim the same run journal', async () => {
  const { approval } = await preview();
  const results = await Promise.all(
    [1, 2].map(() => runLangfuseCli(publishArgs(approval), dependencies())),
  );
  expect(results.map((r) => r.exitCode).sort()).toEqual([0, 2]);
  expect(starts).toBe(1);
});

test.each([
  'throw',
  'wrong-run',
  'wrong-trace',
  'wrong-item',
  'wrong-name',
  'duplicate-id',
])('unconfirmed %s receipt stops after the accepted prefix with no retry', async (failure) => {
  await save([
    ...records(),
    ...records().map((row) => ({ ...row, scenarioId: 'weather2' })),
  ]);
  const { approval, plan } = await preview();
  let calls = 0;
  const outcome = await runLangfuseCli(
    publishArgs(approval),
    dependencies(async (request) => {
      calls++;
      if (calls === 1) return receipt(request);
      if (failure === 'throw') throw new Error('SECRET PROVIDER ERROR');
      const result = receipt(request, failure === 'duplicate-id' ? 0 : calls);
      if (failure === 'wrong-run') result.datasetRunId = 'other';
      if (failure === 'wrong-trace') result.traceId = 'other';
      if (failure === 'wrong-item') result.datasetItemId = 'other';
      if (failure === 'wrong-name') result.datasetRunName = 'other';
      return result;
    }),
  );
  expect(outcome).toMatchObject({
    exitCode: 3,
    output: { status: 'partial', attempted: 2, accepted: 1, unsent: 2 },
  });
  expect(calls).toBe(2);
  expect((await journal(plan)).at(-2)).toMatchObject({
    status: 'uncertain',
    reconciliationRequired: true,
  });
  expect(
    (await runLangfuseCli(publishArgs(approval), dependencies())).output.code,
  ).toBe('run_link_journal_unavailable');
  sanitized(outcome);
  expect(JSON.stringify(await journal(plan))).not.toContain('SECRET');
});

test('deadline remains uncertain, stops later links, and an uncooperative request cannot change the journal later', async () => {
  const overrides = { 'timeout-ms': '10', 'shutdown-timeout-ms': '5' };
  const { approval, plan } = await preview(overrides);
  let settle!: (value: ReturnType<typeof receipt>) => void;
  let signal: AbortSignal | undefined;
  const outcome = await runLangfuseCli(
    publishArgs(approval, overrides),
    dependencies((_, options) => {
      signal = options.abortSignal;
      return new Promise((resolve) => {
        settle = resolve;
      });
    }),
  );
  expect(outcome).toMatchObject({
    exitCode: 3,
    output: {
      status: 'uncertain',
      attempted: 1,
      accepted: 0,
      unsent: 1,
      shutdown: 'uncertain',
    },
  });
  expect(signal?.aborted).toBe(true);
  const before = await journal(plan);
  settle(receipt(plan.requests[0]));
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(await journal(plan)).toEqual(before);
  expect(
    (await runLangfuseCli(publishArgs(approval, overrides), dependencies()))
      .output.code,
  ).toBe('run_link_journal_unavailable');
});

test('a startup failure keeps a durable blocking journal and no sent associations', async () => {
  const { approval, plan } = await preview();
  const outcome = await runLangfuseCli(publishArgs(approval), {
    ...dependencies(),
    startLinkClient: () => {
      throw new Error('SECRET STARTUP');
    },
  });
  expect(outcome).toMatchObject({
    exitCode: 1,
    output: { status: 'failed', attempted: 0, unsent: 2 },
  });
  expect((await journal(plan)).at(-1).status).toBe('failed');
  sanitized(outcome);
});

test.each([
  3, 4,
])('journal sync failure at step %i never allows a falsely accepted or unjournaled POST', async (failAt) => {
  const { approval, plan } = await preview();
  const probe = await open(join(directory, 'probe'), 'w');
  const prototype: FileHandle = Object.getPrototypeOf(probe);
  const original = prototype.sync;
  let syncs = 0;
  let sends = 0;
  const fault = spyOn(prototype, 'sync').mockImplementation(function (
    this: FileHandle,
  ) {
    if (++syncs === failAt)
      return Promise.reject(new Error('SECRET DISK ERROR'));
    return original.call(this);
  });
  try {
    const outcome = await runLangfuseCli(
      publishArgs(approval),
      dependencies(async (request) => {
        sends++;
        return receipt(request);
      }),
    );
    expect(outcome).toMatchObject({
      exitCode: failAt === 3 ? 1 : 3,
      output: {
        status: failAt === 3 ? 'failed' : 'uncertain',
        accepted: 0,
      },
    });
    expect(sends).toBe(failAt === 3 ? 0 : 1);
    expect(
      (await runLangfuseCli(publishArgs(approval), dependencies())).output.code,
    ).toBe('run_link_journal_unavailable');
    expect(JSON.stringify(await journal(plan))).not.toContain('SECRET');
    sanitized(outcome);
  } finally {
    fault.mockRestore();
    await probe.close();
  }
});

test('real pinned SDK uses only dataset-run-items POST and serializes explicit createdAt without datasetVersion', async () => {
  const { approval, plan } = await preview();
  const hook = join(directory, 'sdk-hook.mjs');
  await writeFile(
    hook,
    `
    const expected = ${JSON.stringify(plan.requests)};
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://langfuse.invalid/api/public/dataset-run-items' || init.method !== 'POST') throw new Error('Unexpected API');
      const request = JSON.parse(init.body);
      if (JSON.stringify(request) !== JSON.stringify(expected[calls])) throw new Error('Payload mismatch');
      calls++;
      return new Response(JSON.stringify({ id: 'association-' + calls, datasetRunId: 'run-1', datasetRunName: request.runName, datasetItemId: request.datasetItemId, traceId: request.traceId, observationId: null, createdAt: request.createdAt, updatedAt: request.createdAt }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    process.once('exit', () => { if (calls !== expected.length) throw new Error('Missing calls'); });
  `,
  );
  const child = spawnSync(
    'node',
    [
      '--import',
      pathToFileURL(hook).href,
      resolve('tools/evals-langfuse/cli.ts'),
      ...publishArgs(approval),
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        PATH: process.env.PATH ?? '',
        LANGFUSE_PUBLIC_KEY: 'synthetic-public',
        LANGFUSE_SECRET_KEY: 'synthetic-secret',
        LANGFUSE_DEBUG: 'true',
      },
    },
  );
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toMatchObject({
    status: 'accepted',
    accepted: 2,
    unsent: 0,
  });
  sanitized(child.stdout);
});
