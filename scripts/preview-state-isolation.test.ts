import { expect, test } from 'bun:test';

import {
  OSS_PREVIEW_STATE_STORE_WORKER,
  PREVIEW_ISOLATION_WORKFLOW,
} from '../infra/platform/src/PreviewStateStoreContract.ts';
import {
  assertIsolationReceipt,
  assertIsolationRun,
} from './preview-state-isolation-receipt.ts';
import {
  assertIsolationAuthority,
  isolationPullNumbers,
  previewIsolationContext,
  type IsolationGithubRequest,
} from './preview-state-isolation.ts';

const sourceSha = 'b'.repeat(40);
const controlSha = 'a'.repeat(40);
const accountId = 'c'.repeat(32);
const env = {
  GITHUB_REPOSITORY: 'maelstrom-co/maelstrom',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  CI: 'true',
  ISOLATION_MODE: 'copy',
  SOURCE_REVIEWED: 'true',
  SOURCE_SHA: sourceSha,
  GITHUB_SHA: controlSha,
  SOURCE_PR: '413',
  GITHUB_RUN_ID: '600',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_TRIGGERING_ACTOR: 'NachoVazquez',
  CALLERS_PAUSED: 'true',
  CONFIRM_ISOLATION: 'true',
  ALCHEMY_REQUIRED_VERSION: '2.0.0-beta.85',
};
const context = previewIsolationContext(env);
const sourceRun = {
  id: 600,
  status: 'completed',
  conclusion: 'success',
  path: PREVIEW_ISOLATION_WORKFLOW,
  head_sha: controlSha,
  head_branch: 'main',
  event: 'workflow_dispatch',
  run_attempt: 1,
  updated_at: new Date().toISOString(),
  head_repository: { full_name: 'maelstrom-co/maelstrom' },
};
const request =
  (
    change: { active?: boolean; moved?: boolean } = {},
  ): IsolationGithubRequest =>
  async <T>(path: string) => {
    const value = path.startsWith('/collaborators/')
      ? { permission: 'admin', role_name: 'admin' }
      : path === '/commits/main'
        ? { sha: change.moved ? sourceSha : controlSha }
        : path.startsWith('/pulls/')
          ? {
              state: 'open',
              base: { ref: 'main' },
              labels: [],
              head: { sha: sourceSha, repo: sourceRun.head_repository },
            }
          : path.includes('/ci.yml/runs')
            ? {
                workflow_runs: [
                  {
                    ...sourceRun,
                    head_sha: sourceSha,
                    event: 'pull_request',
                    path: '.github/workflows/ci.yml',
                  },
                ],
              }
            : path.includes('/runs?')
              ? { total_count: change.active ? 101 : 0, workflow_runs: [] }
              : {
                  state: 'disabled_manually',
                  path: `.github/workflows/${path.split('/').at(-1)}`,
                };
    return value as T;
  };

test('copy requires explicit approval, frozen OSS callers and inactive routing', () => {
  expect(context.mode).toBe('copy');
  for (const change of [
    { CI: 'false' },
    { GITHUB_REF: 'refs/heads/other' },
    { SOURCE_REVIEWED: 'false' },
    { CALLERS_PAUSED: 'false' },
    { CONFIRM_ISOLATION: 'false' },
    { ALCHEMY_REQUIRED_VERSION: '' },
    { ALCHEMY_PREVIEW_STATE_STORE_WORKER: OSS_PREVIEW_STATE_STORE_WORKER },
    { ISOLATION_MODE: 'verify' },
  ]) {
    expect(() => previewIsolationContext({ ...env, ...change })).toThrow();
  }
});

test('inventory does not pretend active callers have been paused', async () => {
  const inventory = previewIsolationContext({
    ...env,
    ISOLATION_MODE: 'inventory',
    CALLERS_PAUSED: 'false',
    CONFIRM_ISOLATION: 'false',
    ALCHEMY_REQUIRED_VERSION: '',
  });
  await expect(
    assertIsolationAuthority(request({ active: true }), inventory),
  ).resolves.toBeUndefined();
  await expect(
    assertIsolationAuthority(request({ active: true }), context),
  ).rejects.toThrow('ISOLATION_WRITERS_NOT_PAUSED');
});

test('main revision drift stops privileged batches', async () => {
  await expect(
    assertIsolationAuthority(request({ moved: true }), context),
  ).rejects.toThrow('ISOLATION_CONTROL_MOVED');
});

test('all closed and open PR pages are included before outputs-only stages are probed', async () => {
  const pages: string[] = [];
  const numbers = await isolationPullNumbers(async <T>(path: string) => {
    pages.push(path);
    return (
      path.endsWith('page=1')
        ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
        : [{ number: 101 }]
    ) as T;
  });
  expect(numbers).toHaveLength(101);
  expect(numbers).toContain('101');
  expect(pages).toHaveLength(2);
  expect(pages[0]).toContain('state=all');
});

test('a fresh successful copy run is required, not an inventory or stale attempt', async () => {
  const load = async <T>() => sourceRun as T;
  await expect(
    assertIsolationRun(load, { runId: '600', controlSha }),
  ).resolves.toEqual(sourceRun);
  await expect(
    assertIsolationRun(
      async <T>() => ({ ...sourceRun, conclusion: 'failure' }) as T,
      { runId: '600', controlSha },
    ),
  ).rejects.toThrow();
});

test('receipts bind whole-scope verification to the exact candidate and named worker', () => {
  const expected = {
    runId: '600',
    attempt: '1',
    controlSha,
    sourceSha,
    accountId,
  };
  const receipt = {
    ...expected,
    version: '2.0.0-beta.85',
    mode: 'copy',
    sourceWorker: 'alchemy-state-store',
    destinationWorker: OSS_PREVIEW_STATE_STORE_WORKER,
    sourceProtocol: 7,
    destinationProtocol: 8,
    resources: 1,
    outputs: 1,
    legacyWorkers: 0,
    sourceUnchanged: true,
    manifestVerified: true,
    destinationWasAbsent: true,
    defaultStorePreserved: true,
    scopes: [
      {
        stack: 'MaelstromDemoPreview',
        stage: 'pr-42',
        resources: 1,
        output: true,
      },
    ],
  };
  expect(() => assertIsolationReceipt(receipt, expected)).not.toThrow();
  for (const change of [
    { mode: 'inventory' },
    { sourceSha: controlSha },
    { attempt: '2' },
    { destinationWorker: 'alchemy-state-store' },
    { resources: 0 },
    { destinationWasAbsent: false },
    {
      scopes: [
        {
          stack: 'MaelstromCloudFoundation',
          stage: 'dev',
          resources: 1,
          output: true,
        },
      ],
    },
  ])
    expect(() =>
      assertIsolationReceipt({ ...receipt, ...change }, expected),
    ).toThrow();
});
