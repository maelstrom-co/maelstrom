import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertCandidate,
  assertPreviewReceipt,
  assertPreviewRun,
  assertWritersPaused,
  cleanupVersion,
  executeMaintenance,
  maintenanceContext,
  stateDigest,
} from './alchemy-state-maintenance.ts';
import { alchemyProjects } from './alchemy-version.ts';

const sourceSha = 'b'.repeat(40);
const controlSha = 'a'.repeat(40);
const environment = (target = 'preview') => ({
  GITHUB_REPOSITORY: 'maelstrom-co/maelstrom',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_SHA: controlSha,
  GITHUB_RUN_ID: '600',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_TRIGGERING_ACTOR: 'NachoVazquez',
  SOURCE_SHA: sourceSha,
  SOURCE_PR: '413',
  MAINTENANCE_TARGET: target,
  CALLERS_PAUSED: 'true',
  SOURCE_REVIEWED: 'true',
  ALCHEMY_REQUIRED_VERSION: '2.0.0-beta.85',
  CONFIRM_PRODUCTION: 'true',
  PREVIEW_RUN_ID: '500',
});
const run = {
  id: 500,
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/alchemy-state-maintenance.yml',
  head_sha: controlSha,
  head_branch: 'main',
  event: 'workflow_dispatch',
  run_attempt: 1,
  head_repository: { full_name: 'maelstrom-co/maelstrom' },
};
const goodReceipt = {
  target: 'preview',
  sourceSha,
  controlSha,
  runId: '500',
  attempt: '1',
  version: '2.0.0-beta.85',
  protocol: 8,
  existingStatePreserved: true,
  canaryPassed: true,
  cleanupPassed: true,
};
const context = maintenanceContext(environment());

test('production requires a separate explicit request, reviewed source, and an outside-caller freeze', () => {
  for (const change of [
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'attacker/fork' },
    { SOURCE_SHA: 'main' },
    { CALLERS_PAUSED: 'false' },
    { SOURCE_REVIEWED: 'false' },
    { ALCHEMY_REQUIRED_VERSION: '' },
    { MAINTENANCE_TARGET: 'production', CONFIRM_PRODUCTION: 'false' },
    { MAINTENANCE_TARGET: 'production', PREVIEW_RUN_ID: '' },
  ])
    expect(() => maintenanceContext({ ...environment(), ...change })).toThrow();
});

test('refuses a disabled writer with an active run beyond the first returned page', async () => {
  await expect(
    assertWritersPaused(async <T>(path: string) => {
      if (path.includes('/runs?'))
        return { total_count: 101, workflow_runs: [] } as T;
      return {
        state: 'disabled_manually',
        path: `.github/workflows/${path.split('/').at(-1)}`,
      } as T;
    }),
  ).rejects.toThrow('Drain');
  await expect(
    assertWritersPaused(async <T>() => ({ state: 'active' }) as T),
  ).rejects.toThrow('Disable');
});

test('a newer failed CI run cannot borrow an earlier success for the same candidate', async () => {
  const pull = {
    state: 'open',
    base: { ref: 'main' },
    labels: [],
    head: { sha: sourceSha, repo: run.head_repository },
  };
  const ci = {
    ...run,
    head_sha: sourceSha,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
  };
  await expect(
    assertCandidate(
      async <T>(path: string) =>
        (path.startsWith('/pulls/')
          ? pull
          : { workflow_runs: [{ ...ci, conclusion: 'failure' }, ci] }) as T,
      context,
    ),
  ).rejects.toThrow('latest');
});

test('production receipts cannot be replayed across source revisions, control revisions, or attempts', async () => {
  const production = maintenanceContext(environment('production'));
  expect(() =>
    assertPreviewReceipt(goodReceipt, production, run),
  ).not.toThrow();
  for (const change of [
    { sourceSha: 'c'.repeat(40) },
    { controlSha: 'c'.repeat(40) },
    { target: 'production' },
    { attempt: '2' },
    { protocol: 7 },
    { existingStatePreserved: false },
    { canaryPassed: false },
    { cleanupPassed: false },
  ])
    expect(() =>
      assertPreviewReceipt({ ...goodReceipt, ...change }, production, run),
    ).toThrow();
  await expect(
    assertPreviewRun(
      async <T>() => ({ ...run, path: '.github/workflows/ci.yml' }) as T,
      production,
    ),
  ).rejects.toThrow('successful preview');
});

test('cleanup cannot implicitly migrate an uncertain store or reuse the old CLI after bootstrap starts', () => {
  expect(cleanupVersion(7, false)).toBe('2.0.0-beta.83');
  expect(cleanupVersion(8, true)).toBe('2.0.0-beta.85');
  for (const protocol of [7, 0, 9])
    expect(() => cleanupVersion(protocol, true)).toThrow('uncertain');
});

test('preservation checks decrypt and compare record contents, not object key order', () => {
  expect(stateDigest('{"attr":{"name":"owned"},"props":{"a":1,"b":2}}')).toBe(
    stateDigest('{"props":{"b":2,"a":1},"attr":{"name":"owned"}}'),
  );
  expect(stateDigest('{"attr":{"name":"owned"}}')).not.toBe(
    stateDigest('{"attr":{"name":"foreign"}}'),
  );
  expect(() => stateDigest('{"attr":null}')).toThrow('complete attributes');
});

async function fixture(
  options: {
    target?: 'preview' | 'production';
    failRead?: boolean;
    failBootstrap?: 7 | 8;
    moveHead?: boolean;
    changeRecord?: boolean;
    wrongAccount?: boolean;
    delayedCanary?: boolean;
  } = {},
) {
  const directory = await mkdtemp('/tmp/alchemy-maintenance-');
  const control = join(directory, 'control');
  const source = join(directory, 'source');
  for (const [root, version] of [
    [control, '2.0.0-beta.83'],
    [source, '2.0.0-beta.85'],
  ] as const) {
    const alchemy = join(root, 'infra/platform/node_modules/alchemy');
    await mkdir(alchemy, { recursive: true });
    await writeFile(join(alchemy, 'package.json'), JSON.stringify({ version }));
  }
  for (const project of alchemyProjects) {
    const directory = join(source, project, 'node_modules/alchemy');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ version: '2.0.0-beta.85' }),
    );
    const provider = join(
      source,
      project,
      'node_modules/@alchemy.run/cloudflare',
    );
    await mkdir(provider, { recursive: true });
    await writeFile(
      join(provider, 'package.json'),
      JSON.stringify({ version: '2.0.0-beta.85' }),
    );
  }
  const provider = join(
    source,
    'infra/platform/node_modules/@alchemy.run/cloudflare',
  );
  await mkdir(provider, { recursive: true });
  await writeFile(
    join(provider, 'package.json'),
    JSON.stringify({ version: '2.0.0-beta.85' }),
  );
  const target = options.target ?? 'preview';
  const account = target === 'preview' ? 'c'.repeat(32) : 'd'.repeat(32);
  const env = {
    ...environment(target),
    CONTROL_ROOT: control,
    SOURCE_ROOT: source,
    RECEIPT_OUTPUT: join(directory, 'receipt.json'),
    GH_TOKEN: 'never-inherit-github-token',
    UNRELATED_SECRET: 'never-inherit-another-secret',
    PREVIEW_ACCOUNT_ID: 'c'.repeat(32),
    PRODUCTION_ACCOUNT_ID: 'd'.repeat(32),
    CLOUDFLARE_ACCOUNT_ID: options.wrongAccount ? 'f'.repeat(32) : account,
    CLOUDFLARE_API_TOKEN: 'offline-token',
    PREVIEW_WORKERS_DEV_SUFFIX: 'fixture.workers.dev',
  };
  const calls: Array<{ phase: string; root: string; argv: string[] }> = [];
  let protocol = 7;
  let moved = false;
  let baselineReads = 0;
  let canaryReads = 0;
  const request = async <T>(path: string) => {
    if (path.startsWith('/pulls/'))
      return {
        state: 'open',
        base: { ref: 'main' },
        labels: [],
        head: {
          sha: moved ? 'f'.repeat(40) : sourceSha,
          repo: run.head_repository,
        },
      } as T;
    if (path.includes('ci.yml/runs'))
      return {
        workflow_runs: [
          {
            ...run,
            head_sha: sourceSha,
            path: '.github/workflows/ci.yml',
            event: 'pull_request',
          },
        ],
      } as T;
    if (path.includes('/runs?'))
      return { total_count: 0, workflow_runs: [] } as T;
    return {
      state: 'disabled_manually',
      path: `.github/workflows/${path.split('/').at(-1)}`,
    } as T;
  };
  const ops = {
    sleep: async () => {},
    verifyCheckout: async () => {},
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === 'api.cloudflare.com')
        return Response.json({
          success: true,
          result: { subdomain: 'fixture' },
        });
      if (url.pathname === '/version')
        return Response.json({ version: protocol });
      canaryReads++;
      if (options.delayedCanary && canaryReads < 4)
        return new Response('propagating', { status: 503 });
      return new Response('alchemy-state-canary-600-1');
    }) as typeof fetch,
    run: async (operation: {
      argv: string[];
      cwd: string;
      env: Record<string, string>;
      phase: string;
    }) => {
      expect(operation.env.GH_TOKEN).toBeUndefined();
      expect(operation.env.UNRELATED_SECRET).toBeUndefined();
      expect(operation.argv).toContain('--no-env-file');
      calls.push({
        phase: operation.phase,
        root: operation.cwd,
        argv: operation.argv,
      });
      if (operation.phase === 'bootstrap-state-store') {
        protocol = options.failBootstrap ?? 8;
        if (options.failBootstrap)
          throw new Error('simulated partial bootstrap');
      }
      if (operation.phase.startsWith('read-existing-state')) {
        baselineReads++;
        if (options.failRead && baselineReads === 1)
          throw new Error('simulated baseline failure');
        return JSON.stringify({
          attr: {
            name:
              options.changeRecord && baselineReads > 1 ? 'foreign' : 'owned',
          },
          secret: 'not-for-logs',
        });
      }
      if (operation.phase === 'deploy-preview-canary' && options.moveHead)
        moved = true;
      return '';
    },
  };
  let failure: unknown;
  try {
    await executeMaintenance(env, maintenanceContext(env), request, ops);
  } catch (error) {
    failure = error;
  }
  const receipt = (await Bun.file(env.RECEIPT_OUTPUT).exists())
    ? JSON.parse(await readFile(env.RECEIPT_OUTPUT, 'utf8'))
    : undefined;
  await rm(directory, { recursive: true, force: true });
  return { calls, failure, receipt, control, source, canaryReads };
}

test('preview verifies the original encrypted record before updating and cleaning its canary with beta.85', async () => {
  const result = await fixture();
  expect(result.failure).toBeUndefined();
  expect(result.calls.map((call) => call.phase)).toEqual([
    'seed-preview-before-upgrade',
    'read-existing-state-before-upgrade',
    'bootstrap-state-store',
    'read-existing-state-after-upgrade',
    'deploy-preview-canary',
    'cleanup-preview-canary',
  ]);
  expect(result.calls[0]?.root).toContain('/control/');
  expect(result.calls.at(-1)?.root).toContain('/source/');
  expect(result.receipt).toMatchObject({
    existingStatePreserved: true,
    canaryPassed: true,
    cleanupPassed: true,
  });
});

test('a baseline failure cleans up with beta.83 and never attempts the protocol upgrade', async () => {
  const result = await fixture({ failRead: true });
  expect(result.failure).toBeDefined();
  expect(
    result.calls.some((call) => call.phase === 'bootstrap-state-store'),
  ).toBe(false);
  expect(result.calls.at(-1)).toMatchObject({
    phase: 'cleanup-preview-canary',
  });
  expect(result.calls.at(-1)?.root).toContain('/control/');
  expect(result.receipt).toBeUndefined();
});

for (const protocol of [7, 8] as const) {
  test(`a partially failed upgrade never sends beta.83 cleanup into a possibly upgraded store (${protocol})`, async () => {
    const result = await fixture({ failBootstrap: protocol });
    expect(result.failure).toBeDefined();
    const cleanup = result.calls.filter(
      (call) => call.phase === 'cleanup-preview-canary',
    );
    if (protocol === 7) expect(cleanup).toEqual([]);
    else expect(cleanup[0]?.root).toContain('/source/');
    expect(result.receipt).toBeUndefined();
  });
}

test('a moved PR head cannot prevent cleanup of the immutable deployed canary', async () => {
  const result = await fixture({ moveHead: true });
  expect(result.failure).toBeUndefined();
  expect(result.calls.at(-1)?.phase).toBe('cleanup-preview-canary');
});

test('changed existing state refuses a successful receipt and never reaches the production dry-run', async () => {
  const result = await fixture({ target: 'production', changeRecord: true });
  expect(result.failure).toBeDefined();
  expect(
    result.calls.some((call) => call.phase === 'production-platform-dry-run'),
  ).toBe(false);
  expect(result.receipt).toBeUndefined();
});

test('production verifies existing state and invokes only a dry-run after its explicit bootstrap', async () => {
  const result = await fixture({ target: 'production' });
  expect(result.failure).toBeUndefined();
  const deployment = result.calls.filter((call) =>
    call.argv.includes('deploy'),
  );
  expect(deployment).toHaveLength(1);
  expect(deployment[0]?.argv).toContain('--dry-run');
  expect(
    result.calls.some(
      (call) => call.argv.includes('--force') || call.argv.includes('teardown'),
    ),
  ).toBe(false);
});

test('a swapped account cannot reach bootstrap or any other Alchemy command', async () => {
  const result = await fixture({ wrongAccount: true });
  expect(result.failure).toBeDefined();
  expect(result.calls).toEqual([]);
});

test('retries the read-only canary probe while its version propagates without replaying deployment', async () => {
  const result = await fixture({ delayedCanary: true });
  expect(result.failure).toBeUndefined();
  expect(result.canaryReads).toBe(4);
  expect(
    result.calls.filter((call) => call.phase === 'deploy-preview-canary'),
  ).toHaveLength(1);
});
