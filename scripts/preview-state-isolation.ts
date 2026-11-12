import { spawnSync } from 'node:child_process';

import { OSS_PREVIEW_STATE_STORE_WORKER } from '../infra/platform/src/PreviewStateStoreContract.ts';
import {
  assertCandidate,
  assertWritersPaused,
} from './alchemy-state-maintenance.ts';
import {
  assertWorkspaceAlchemyVersion,
  assertPreviewStateStore,
} from './alchemy-version.ts';

const repository = 'maelstrom-co/maelstrom';

/** Immutable authorization context shared by trusted preflight and the reviewed client. */
export interface PreviewIsolationContext {
  /** Inventory never creates a destination or authorizes cutover. */
  readonly mode: 'inventory' | 'copy';
  /** Always preview; no production secret is used by this workflow. */
  readonly target: 'preview';
  /** Exact candidate program revision. */
  readonly sourceSha: string;
  /** Exact main workflow revision. */
  readonly controlSha: string;
  /** Open candidate PR, bound to its current head. */
  readonly pull: string;
  /** Current workflow run used in the redacted receipt. */
  readonly runId: string;
  /** Current attempt, so reruns cannot borrow an earlier receipt. */
  readonly attempt: string;
  /** GitHub maintainer whose authority is checked again between batches. */
  readonly actor: string;
  /** Isolation is the first preview step and cannot borrow a production receipt. */
  readonly previewRun: undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;
/** Read-only repository lookup; no write endpoint is exposed to the transfer. */
export type IsolationGithubRequest = <T>(path: string) => Promise<T>;

/** Validates manual execution before account credentials are made available. */
export function previewIsolationContext(
  env: Environment,
): PreviewIsolationContext {
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.CI !== 'true'
  )
    throw new Error('ISOLATION_MANUAL_MAIN_REQUIRED');
  if (
    !['inventory', 'copy'].includes(env.ISOLATION_MODE ?? '') ||
    env.SOURCE_REVIEWED !== 'true'
  )
    throw new Error('ISOLATION_REVIEW_REQUIRED');
  if (
    ![env.SOURCE_SHA, env.GITHUB_SHA].every(
      (value) => !!value && /^[0-9a-f]{40}$/.test(value),
    )
  )
    throw new Error('ISOLATION_EXACT_REVISION_REQUIRED');
  if (
    ![env.SOURCE_PR, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT].every(
      (value) => !!value && /^[1-9]\d{0,15}$/.test(value),
    )
  )
    throw new Error('ISOLATION_RUN_ID_REQUIRED');
  const actor = env.GITHUB_TRIGGERING_ACTOR ?? env.GITHUB_ACTOR;
  if (!actor || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(actor))
    throw new Error('ISOLATION_OPERATOR_REQUIRED');
  if (
    env.ISOLATION_MODE === 'copy' &&
    (env.CALLERS_PAUSED !== 'true' ||
      env.CONFIRM_ISOLATION !== 'true' ||
      env.ALCHEMY_REQUIRED_VERSION !== '2.0.0-beta.85' ||
      !!env.ALCHEMY_PREVIEW_STATE_STORE_WORKER)
  )
    throw new Error('ISOLATION_COPY_WINDOW_REQUIRED');
  return {
    mode: env.ISOLATION_MODE === 'copy' ? 'copy' : 'inventory',
    target: 'preview',
    sourceSha: env.SOURCE_SHA ?? '',
    controlSha: env.GITHUB_SHA ?? '',
    pull: env.SOURCE_PR ?? '',
    runId: env.GITHUB_RUN_ID ?? '',
    attempt: env.GITHUB_RUN_ATTEMPT ?? '',
    actor,
    previewRun: undefined,
  };
}

/** Creates only authenticated GET lookups, with fixed origin and redacted errors. */
export function isolationGithubRequest(
  token: string | undefined,
  transport: typeof fetch = fetch,
): IsolationGithubRequest {
  if (!token || /\s/.test(token))
    throw new Error('ISOLATION_GITHUB_READ_TOKEN_REQUIRED');
  return async <T>(path: string) => {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('ISOLATION_LOOKUP_REJECTED');
    const response = await transport(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error('ISOLATION_GITHUB_LOOKUP_FAILED');
    return (await response.json()) as T;
  };
}

/** Rechecks freeze, authority and provenance before each bounded mutation batch. */
export async function assertIsolationAuthority(
  request: IsolationGithubRequest,
  context: PreviewIsolationContext,
) {
  const operator = await request<{ permission: string; role_name: string }>(
    `/collaborators/${context.actor}/permission`,
  );
  if (
    !(
      (operator.permission === 'admin' && operator.role_name === 'admin') ||
      (operator.permission === 'write' && operator.role_name === 'maintain')
    )
  )
    throw new Error('ISOLATION_OPERATOR_REQUIRED');
  const main = await request<{ sha: string }>('/commits/main');
  if (main.sha !== context.controlSha)
    throw new Error('ISOLATION_CONTROL_MOVED');
  try {
    await assertCandidate(request, context);
  } catch {
    throw new Error('ISOLATION_CANDIDATE_INELIGIBLE');
  }
  if (context.mode === 'copy') {
    try {
      await assertWritersPaused(request);
      for (const file of [
        'alchemy-state-maintenance.yml',
        'preview-state-isolation.yml',
      ]) {
        for (const status of [
          'requested',
          'queued',
          'waiting',
          'pending',
          'in_progress',
        ]) {
          const runs = await request<{
            total_count: number;
            workflow_runs: { id: number }[];
          }>(`/actions/workflows/${file}/runs?status=${status}&per_page=100`);
          if (
            !Array.isArray(runs.workflow_runs) ||
            runs.total_count !== runs.workflow_runs.length ||
            runs.workflow_runs.some((run) => String(run.id) !== context.runId)
          )
            throw new Error('ISOLATION_COMPETING_RUN');
        }
      }
    } catch {
      throw new Error('ISOLATION_WRITERS_NOT_PAUSED');
    }
  }
}

/** Checks exact installed code before running the candidate with preview credentials. */
export function assertIsolationSource(root: string, sourceSha: string) {
  const head = spawnSync(
    '/usr/bin/git',
    ['--no-replace-objects', 'rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8' },
  );
  const clean = spawnSync(
    '/usr/bin/git',
    ['--no-replace-objects', 'diff', '--exit-code', 'HEAD', '--'],
    { cwd: root, encoding: 'utf8' },
  );
  if (
    head.status !== 0 ||
    head.stdout.trim() !== sourceSha ||
    clean.status !== 0
  )
    throw new Error('ISOLATION_SOURCE_TREE_CHANGED');
  assertWorkspaceAlchemyVersion(root, '2.0.0-beta.85');
  assertPreviewStateStore(root, OSS_PREVIEW_STATE_STORE_WORKER);
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Enumerates closed as well as open PRs to preserve known outputs-only stages. */
export async function isolationPullNumbers(request: IsolationGithubRequest) {
  const numbers = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    const pulls = await request<unknown>(
      `/pulls?state=all&sort=created&direction=asc&per_page=100&page=${page}`,
    );
    if (!Array.isArray(pulls) || pulls.length > 100)
      throw new Error('ISOLATION_PR_INVENTORY_INVALID');
    for (const pull of pulls) {
      if (
        !record(pull) ||
        !Number.isSafeInteger(pull.number) ||
        Number(pull.number) < 1
      )
        throw new Error('ISOLATION_PR_INVENTORY_INVALID');
      const number = String(pull.number);
      if (numbers.has(number))
        throw new Error('ISOLATION_PR_INVENTORY_CHANGED');
      numbers.add(number);
    }
    if (pulls.length < 100) return [...numbers].sort();
  }
  throw new Error('ISOLATION_PR_INVENTORY_LIMIT');
}

async function main() {
  const context = previewIsolationContext(process.env);
  const request = isolationGithubRequest(process.env.GH_TOKEN);
  await assertIsolationAuthority(request, context);
  if (process.argv[2] === 'check-source') {
    if (!process.env.SOURCE_ROOT)
      throw new Error('ISOLATION_SOURCE_ROOT_REQUIRED');
    assertIsolationSource(process.env.SOURCE_ROOT, context.sourceSha);
  } else if (process.argv[2] !== 'check')
    throw new Error('ISOLATION_CHECK_MODE_REQUIRED');
  console.log('Preview isolation preflight passed.');
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error &&
        /^(ISOLATION|PREVIEW)_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'ISOLATION_PREFLIGHT_FAILED',
    );
    process.exitCode = 1;
  }
}
