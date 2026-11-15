import {
  OSS_PREVIEW_STATE_STORE_WORKER,
  OSS_PREVIEW_STACKS,
  OSS_PREVIEW_STAGE_PATTERN,
  PREVIEW_ISOLATION_WORKFLOW,
} from '../infra/platform/src/PreviewStateStoreContract.ts';
import type { PreviewCopyProof } from './preview-state-copy.ts';
import type { IsolationGithubRequest } from './preview-state-isolation.ts';

const repository = 'maelstrom-co/maelstrom';

/** Rejects a resumed workflow or artifact from another source/control revision. */
export async function assertIsolationRun(
  request: IsolationGithubRequest,
  expected: { readonly runId: string; readonly controlSha: string },
) {
  const run = await assertCopyOriginRun(request, expected.runId);
  if (run.head_sha !== expected.controlSha)
    throw new Error('ISOLATION_SUCCESSFUL_RUN_REQUIRED');
  return run;
}

/** Authenticates an immutable successful fresh-copy origin without rebinding its revisions. */
export async function assertCopyOriginRun(
  request: IsolationGithubRequest,
  runId: string,
) {
  if (!/^[1-9]\d{0,15}$/.test(runId))
    throw new Error('ISOLATION_RECEIPT_REQUIRED');
  const run = await request<{
    id: number;
    status: string;
    conclusion: string;
    path: string;
    head_sha: string;
    display_title: string;
    head_branch: string;
    event: string;
    run_attempt: number;
    updated_at: string;
    head_repository: { full_name: string };
  }>(`/actions/runs/${runId}`);
  if (
    String(run.id) !== runId ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== PREVIEW_ISOLATION_WORKFLOW ||
    !/^[0-9a-f]{40}$/.test(run.head_sha) ||
    !/^OSS preview state copy at [0-9a-f]{40}$/.test(run.display_title) ||
    run.head_branch !== 'main' ||
    run.event !== 'workflow_dispatch' ||
    run.head_repository?.full_name !== repository ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    !Number.isFinite(Date.parse(run.updated_at)) ||
    Date.now() - Date.parse(run.updated_at) > 7 * 86_400_000 ||
    Date.parse(run.updated_at) > Date.now() + 60_000
  )
    throw new Error('ISOLATION_SUCCESSFUL_RUN_REQUIRED');
  return run;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Original fresh-copy evidence; revision identities are never replaced during recovery. */
export interface IsolationCopyReceipt extends PreviewCopyProof {
  /** Original successful run. */
  readonly runId: string;
  /** Original workflow attempt. */
  readonly attempt: string;
  /** Trusted control revision that performed the copy. */
  readonly controlSha: string;
  /** Reviewed candidate that performed the copy. */
  readonly sourceSha: string;
  /** Account whose named store received the copy. */
  readonly accountId: string;
}

/** A copy receipt is evidence only for its pinned candidate, account and attempt. */
export function assertIsolationReceipt(
  value: unknown,
  expected: {
    readonly runId: string;
    readonly attempt: string;
    readonly controlSha: string;
    readonly sourceSha: string;
    readonly accountId: string;
  },
): asserts value is IsolationCopyReceipt {
  if (
    !record(value) ||
    value.mode !== 'copy' ||
    value.version !== '2.0.0-beta.85' ||
    value.runId !== expected.runId ||
    value.attempt !== expected.attempt ||
    value.controlSha !== expected.controlSha ||
    value.sourceSha !== expected.sourceSha ||
    value.accountId !== expected.accountId ||
    value.sourceWorker !== 'alchemy-state-store' ||
    value.destinationWorker !== OSS_PREVIEW_STATE_STORE_WORKER ||
    value.sourceProtocol !== 7 ||
    value.destinationProtocol !== 8 ||
    value.sourceUnchanged !== true ||
    value.manifestVerified !== true ||
    value.destinationWasAbsent !== true ||
    value.defaultStorePreserved !== true ||
    !count(value.resources) ||
    !count(value.outputs) ||
    !count(value.legacyWorkers) ||
    !Array.isArray(value.scopes)
  )
    throw new Error('ISOLATION_RECEIPT_MISMATCH');
  const scopes = new Set<string>();
  let resources = 0;
  let outputs = 0;
  for (const scope of value.scopes) {
    if (
      !record(scope) ||
      typeof scope.stack !== 'string' ||
      !OSS_PREVIEW_STACKS.some((entry) => entry.stack === scope.stack) ||
      typeof scope.stage !== 'string' ||
      !OSS_PREVIEW_STAGE_PATTERN.test(scope.stage) ||
      !count(scope.resources) ||
      typeof scope.output !== 'boolean' ||
      scopes.has(`${scope.stack}/${scope.stage}`)
    )
      throw new Error('ISOLATION_RECEIPT_MISMATCH');
    scopes.add(`${scope.stack}/${scope.stage}`);
    resources += Number(scope.resources);
    outputs += Number(scope.output);
  }
  if (
    resources !== value.resources ||
    outputs !== value.outputs ||
    resources + outputs > 1000
  )
    throw new Error('ISOLATION_RECEIPT_MISMATCH');
}

/** Preserves the authenticated origin while a separate current run revalidates its selected state. */
export async function readCopyOrigin(
  request: IsolationGithubRequest,
  runId: string,
  value: unknown,
  accountId: string,
) {
  const run = await assertCopyOriginRun(request, runId);
  if (
    !record(value) ||
    typeof value.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(value.sourceSha)
  )
    throw new Error('ISOLATION_RECEIPT_MISMATCH');
  if (run.display_title !== `OSS preview state copy at ${value.sourceSha}`)
    throw new Error('ISOLATION_RECEIPT_MISMATCH');
  assertIsolationReceipt(value, {
    runId,
    attempt: String(run.run_attempt),
    controlSha: run.head_sha,
    sourceSha: value.sourceSha,
    accountId,
  });
  return value;
}
