import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { OSS_PREVIEW_STATE_STORE_WORKER } from '../infra/platform/src/PreviewStateStoreContract.ts';
import {
  assertAlchemyVersion,
  assertWorkspaceAlchemyVersion,
} from './alchemy-version.ts';
import {
  assertIsolationRun,
  assertIsolationReceipt,
} from './preview-state-isolation-receipt.ts';

const repository = 'maelstrom-co/maelstrom';
const version = '2.0.0-beta.85';
const workflow = '.github/workflows/alchemy-state-maintenance.yml';
const writers = [
  'deploy-production.yml',
  'deploy-playground.yml',
  'deploy-preview.yml',
  'teardown-preview.yml',
  'reconcile-previews.yml',
];
const activeStatuses = [
  'requested',
  'queued',
  'waiting',
  'pending',
  'in_progress',
];
const shaPattern = /^[0-9a-f]{40}$/;
const idPattern = /^[1-9]\d{0,15}$/;

type GithubRequest = <T>(path: string) => Promise<T>;
type Environment = Readonly<Record<string, string | undefined>>;
type Target = 'preview' | 'production';
const requiredValue = (env: Environment, key: string) => {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};
interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  path: string;
  head_sha: string;
  head_branch: string;
  event: string;
  run_attempt: number;
  head_repository: { full_name: string };
}
interface Context {
  target: Target;
  sourceSha: string;
  controlSha: string;
  pull: string;
  runId: string;
  attempt: string;
  previewRun: string | undefined;
  isolationRun?: string;
  actor: string;
}

/** Binds privileged operations to a manual main-branch run and explicit operator acknowledgements. */
export function maintenanceContext(env: Environment): Context {
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  )
    throw new Error('Maintenance must run manually from maelstrom main');
  if (
    env.MAINTENANCE_TARGET !== 'preview' &&
    env.MAINTENANCE_TARGET !== 'production'
  )
    throw new Error('Select preview or production');
  for (const value of [env.SOURCE_SHA, env.GITHUB_SHA])
    if (!value || !shaPattern.test(value))
      throw new Error('An exact source and control SHA is required');
  for (const value of [
    env.SOURCE_PR,
    env.GITHUB_RUN_ID,
    env.GITHUB_RUN_ATTEMPT,
  ])
    if (!value || !idPattern.test(value))
      throw new Error('Invalid maintenance run identity');
  if (env.CALLERS_PAUSED !== 'true' || env.SOURCE_REVIEWED !== 'true')
    throw new Error(
      'Confirm all outside callers are paused and the entire candidate is reviewed',
    );
  if (env.ALCHEMY_REQUIRED_VERSION !== version)
    throw new Error(
      `Set ALCHEMY_REQUIRED_VERSION=${version} before maintenance`,
    );
  if (
    env.MAINTENANCE_TARGET === 'production' &&
    (env.CONFIRM_PRODUCTION !== 'true' ||
      !env.PREVIEW_RUN_ID ||
      !idPattern.test(env.PREVIEW_RUN_ID))
  )
    throw new Error(
      'Production requires explicit confirmation and a successful preview run',
    );
  if (
    env.MAINTENANCE_TARGET === 'preview' &&
    (!env.ISOLATION_RUN_ID ||
      !idPattern.test(env.ISOLATION_RUN_ID) ||
      env.ALCHEMY_PREVIEW_STATE_STORE_WORKER !== OSS_PREVIEW_STATE_STORE_WORKER)
  )
    throw new Error(
      'Preview requires a successful isolation run and the named store pointer',
    );
  const actor = env.GITHUB_TRIGGERING_ACTOR ?? env.GITHUB_ACTOR;
  if (!actor || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(actor))
    throw new Error('Invalid maintenance actor');
  return {
    target: env.MAINTENANCE_TARGET,
    sourceSha: requiredValue(env, 'SOURCE_SHA'),
    controlSha: requiredValue(env, 'GITHUB_SHA'),
    pull: requiredValue(env, 'SOURCE_PR'),
    runId: requiredValue(env, 'GITHUB_RUN_ID'),
    attempt: requiredValue(env, 'GITHUB_RUN_ATTEMPT'),
    previewRun: env.PREVIEW_RUN_ID,
    isolationRun: env.ISOLATION_RUN_ID,
    actor,
  };
}

/** Rejects even a truncated result containing an active caller; zero must be explicit. */
export async function assertWritersPaused(request: GithubRequest) {
  await Promise.all(
    writers.map(async (file) => {
      const state = await request<{ state: string; path: string }>(
        `/actions/workflows/${file}`,
      );
      if (
        state.state !== 'disabled_manually' ||
        state.path !== `.github/workflows/${file}`
      )
        throw new Error(`Disable and drain ${file} before maintenance`);
      await Promise.all(
        activeStatuses.map(async (status) => {
          const runs = await request<{
            total_count: number;
            workflow_runs: unknown[];
          }>(`/actions/workflows/${file}/runs?status=${status}&per_page=1`);
          if (
            runs.total_count !== 0 ||
            !Array.isArray(runs.workflow_runs) ||
            runs.workflow_runs.length !== 0
          )
            throw new Error(
              `Drain ${status} runs of ${file} before maintenance`,
            );
        }),
      );
    }),
  );
}

/** Prevents a changed, forked, unverified, or concurrently deployed source from receiving account credentials. */
export async function assertCandidate(
  request: GithubRequest,
  context: Context,
) {
  const pull = await request<{
    state: string;
    base: { ref: string };
    labels: { name: string }[];
    head: { sha: string; repo: { full_name: string } };
  }>(`/pulls/${context.pull}`);
  if (
    pull.state !== 'open' ||
    pull.base.ref !== 'main' ||
    pull.head.sha !== context.sourceSha ||
    pull.head.repo.full_name !== repository ||
    !Array.isArray(pull.labels) ||
    pull.labels.some((label) => label.name === 'deploy-preview')
  )
    throw new Error(
      'Candidate must remain the exact open same-repository PR head without deploy-preview',
    );
  const runs = await request<{ workflow_runs: Run[] }>(
    `/actions/workflows/ci.yml/runs?head_sha=${context.sourceSha}&event=pull_request&per_page=1`,
  );
  const latest = runs.workflow_runs?.[0];
  if (
    !latest ||
    latest.status !== 'completed' ||
    latest.conclusion !== 'success' ||
    latest.head_sha !== context.sourceSha ||
    latest.event !== 'pull_request' ||
    latest.path !== '.github/workflows/ci.yml' ||
    latest.head_repository.full_name !== repository
  )
    throw new Error('The latest candidate CI run must have succeeded');
}

async function assertOperator(request: GithubRequest, context: Context) {
  const result = await request<{ permission: string; role_name: string }>(
    `/collaborators/${context.actor}/permission`,
  );
  if (
    !(
      (result.permission === 'admin' && result.role_name === 'admin') ||
      (result.permission === 'write' && result.role_name === 'maintain')
    )
  )
    throw new Error('Maintenance requires an administrator or maintainer');
}

/** Requires a completed preview from the same trusted workflow revision before production can start. */
export async function assertPreviewRun(
  request: GithubRequest,
  context: Context,
) {
  const run = await request<Run>(`/actions/runs/${context.previewRun}`);
  if (
    String(run.id) !== context.previewRun ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== workflow ||
    run.head_branch !== 'main' ||
    run.head_sha !== context.controlSha ||
    run.event !== 'workflow_dispatch' ||
    run.head_repository.full_name !== repository
  )
    throw new Error(
      'Production requires a successful preview run of this exact main workflow revision',
    );
  return run;
}

/** Keeps reruns or receipts for another candidate from authorizing production. */
export function assertPreviewReceipt(
  value: unknown,
  context: Context,
  run: Run,
) {
  const receipt = value as Record<string, unknown> | null;
  if (
    !receipt ||
    receipt.target !== 'preview' ||
    receipt.sourceSha !== context.sourceSha ||
    receipt.controlSha !== context.controlSha ||
    receipt.runId !== context.previewRun ||
    receipt.attempt !== String(run.run_attempt) ||
    receipt.version !== version ||
    receipt.protocol !== 8 ||
    receipt.storeWorker !== OSS_PREVIEW_STATE_STORE_WORKER ||
    receipt.existingStatePreserved !== true ||
    receipt.canaryPassed !== true ||
    receipt.cleanupPassed !== true
  )
    throw new Error(
      'Preview receipt does not authorize this production candidate',
    );
}

/** Never lets cleanup start an upgrade or send an old CLI into an attempted upgrade. */
export function cleanupVersion(protocol: number, bootstrapAttempted: boolean) {
  if (protocol === 8) return version;
  if (protocol === 7 && !bootstrapAttempted) return '2.0.0-beta.83';
  throw new Error(
    'State-store protocol is uncertain after bootstrap; repair it before canary cleanup',
  );
}

/** Compares the decrypted record without emitting its contents or encryption material. */
export function stateDigest(stdout: string) {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error('State inspection did not return JSON');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !(value as { attr?: unknown }).attr
  )
    throw new Error(
      'The existing encrypted resource must have complete attributes',
    );
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

const canaryFile = 'alchemy.maintenance-canary.run.ts';
/** Generates the fixed preview-only probe for the matching installed provider API. */
export function canarySource(cliVersion: string, marker: string, name: string) {
  return `import * as Alchemy from 'alchemy';
import * as Cloudflare from '${cliVersion === version ? '@alchemy.run/cloudflare' : 'alchemy/Cloudflare'}';
import * as Effect from 'effect/Effect';
export default Alchemy.Stack('MaelstromStateStoreCanary', {
  providers: Cloudflare.providers(),
  state: Cloudflare.state(${cliVersion === version ? '{ workerName: process.env.ALCHEMY_PREVIEW_STATE_STORE_WORKER!, accountId: process.env.EXPECTED_CLOUDFLARE_ACCOUNT_ID! }' : ''}),
}, Effect.gen(function* () {
  const worker = yield* Cloudflare.Worker('Canary', {
    name: ${JSON.stringify(name)}, workersDev: true,
    script: ${JSON.stringify(`export default { fetch() { return new Response(${JSON.stringify(marker)}); } };`)},
  });
  return { workerName: worker.workerName };
}));
`;
}

function accountEnvironment(env: Environment, context: Context) {
  const preview = env.PREVIEW_ACCOUNT_ID;
  const production = env.PRODUCTION_ACCOUNT_ID;
  if (
    !preview ||
    !production ||
    !/^[0-9a-f]{32}$/.test(preview) ||
    !/^[0-9a-f]{32}$/.test(production) ||
    preview === production
  )
    throw new Error(
      'Expected preview and production accounts must be distinct account IDs',
    );
  const expected = context.target === 'preview' ? preview : production;
  if (env.CLOUDFLARE_ACCOUNT_ID !== expected || !env.CLOUDFLARE_API_TOKEN)
    throw new Error('Selected credentials do not match the expected account');
  return { expected, token: env.CLOUDFLARE_API_TOKEN };
}

interface Operations {
  sleep: (milliseconds: number) => Promise<void>;
  fetch: typeof fetch;
  run: (options: {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    phase: string;
  }) => Promise<string>;
  verifyCheckout: (root: string, sha: string) => Promise<void>;
}

const operations: Operations = {
  sleep: Bun.sleep,
  fetch,
  async run(options) {
    const showPlan = options.phase === 'production-platform-dry-run';
    const child = Bun.spawn(options.argv, {
      cwd: options.cwd,
      env: options.env,
      stdout: showPlan ? 'inherit' : 'pipe',
      stderr: showPlan ? 'inherit' : 'ignore',
      stdin: 'ignore',
    });
    const timer = setTimeout(() => child.kill(9), 300_000);
    try {
      const [stdout, code] = await Promise.all([
        typeof child.stdout === 'object'
          ? new Response(child.stdout).text()
          : Promise.resolve(''),
        child.exited,
      ]);
      if (code !== 0)
        throw new Error(
          `${options.phase} failed (exit ${code}); normal callers must remain paused`,
        );
      return stdout;
    } finally {
      clearTimeout(timer);
    }
  },
  async verifyCheckout(root, sha) {
    const head = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [value, status] = await Promise.all([
      new Response(head.stdout).text(),
      head.exited,
    ]);
    if (status !== 0 || value.trim() !== sha)
      throw new Error('Checkout does not match the approved revision');
    const clean = Bun.spawn(['git', 'diff', '--quiet', 'HEAD', '--'], {
      cwd: root,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if ((await clean.exited) !== 0)
      throw new Error('Tracked checkout changed after approval');
  },
};

/** Preserves an existing encrypted record across bootstrap and keeps failure cleanup on a compatible CLI. */
export async function executeMaintenance(
  env: Environment,
  context: Context,
  request: GithubRequest,
  ops: Operations = operations,
) {
  const control = resolve(requiredValue(env, 'CONTROL_ROOT'));
  const source = resolve(requiredValue(env, 'SOURCE_ROOT'));
  if (control === source || !env.CONTROL_ROOT || !env.SOURCE_ROOT)
    throw new Error('Separate control and source checkouts are required');
  await ops.verifyCheckout(control, context.controlSha);
  await ops.verifyCheckout(source, context.sourceSha);
  const { expected: account, token } = accountEnvironment(env, context);
  const storeWorker =
    context.target === 'preview'
      ? OSS_PREVIEW_STATE_STORE_WORKER
      : 'alchemy-state-store';
  if (context.target === 'preview') {
    const run = await assertIsolationRun(request, {
      runId: context.isolationRun ?? '',
      controlSha: context.controlSha,
    });
    const raw = await readFile(requiredValue(env, 'ISOLATION_RECEIPT'), 'utf8');
    if (raw.length > 262_144) throw new Error('Isolation receipt is too large');
    assertIsolationReceipt(JSON.parse(raw), {
      runId: context.isolationRun ?? '',
      attempt: String(run.run_attempt),
      controlSha: context.controlSha,
      sourceSha: context.sourceSha,
      accountId: account,
    });
  }
  const profile = `${context.target}-ci`;
  const marker = `alchemy-state-canary-${context.runId}-${context.attempt}`;
  const name = `maelstrom-state-canary-${context.runId}-${context.attempt}`;
  const stage = `maintenance-${context.runId}-${context.attempt}`;
  const canaryPath = (root: string) => join(root, 'infra/platform', canaryFile);
  const api = async (path: string) => {
    const response = await ops.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`Cloudflare account lookup failed (${response.status})`);
    const data = (await response.json()) as {
      success: boolean;
      result: { subdomain: string };
    };
    if (
      !data.success ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.result?.subdomain)
    )
      throw new Error('Cloudflare returned an invalid account subdomain');
    return data.result.subdomain;
  };
  const subdomain = await api('/workers/subdomain');
  const host = `${subdomain}.workers.dev`;
  if (context.target === 'preview' && host !== env.PREVIEW_WORKERS_DEV_SUFFIX)
    throw new Error(
      'Preview account subdomain does not match the configured suffix',
    );
  const servedProtocol = async () => {
    const response = await ops.fetch(`https://${storeWorker}.${host}/version`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok)
      throw new Error('Cannot verify the serving state-store protocol');
    const data = (await response.json()) as { version: unknown };
    if (data.version !== 7 && data.version !== 8)
      throw new Error('Unsupported serving state-store protocol');
    return data.version;
  };
  const guard = async (cleanup = false) => {
    accountEnvironment(env, context);
    await assertWritersPaused(request);
    if (!cleanup) await assertCandidate(request, context);
  };
  const invoke = async (
    cliVersion: string,
    args: string[],
    phase: string,
    cleanup = false,
  ) => {
    await guard(cleanup);
    const root = cliVersion === version ? source : control;
    assertAlchemyVersion(root, cliVersion);
    await ops.verifyCheckout(
      root,
      cliVersion === version ? context.sourceSha : context.controlSha,
    );
    const childEnv: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'USERPROFILE', 'SYSTEMROOT']) {
      const value = env[key];
      if (value) childEnv[key] = value;
    }
    Object.assign(childEnv, {
      CI: 'true',
      ALCHEMY_PROFILE: profile,
      CLOUDFLARE_ACCOUNT_ID: account,
      EXPECTED_CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
    });
    if (context.target === 'preview')
      childEnv.ALCHEMY_PREVIEW_STATE_STORE_WORKER =
        OSS_PREVIEW_STATE_STORE_WORKER;
    console.log(JSON.stringify({ phase, target: context.target, cliVersion }));
    return ops.run({
      argv: [
        process.execPath,
        '--no-env-file',
        '--no-install',
        '--config',
        join(control, 'scripts/preview-lifecycle.bunfig.toml'),
        'alchemy',
        ...args,
        '--profile',
        profile,
      ],
      cwd: join(root, 'infra/platform'),
      env: childEnv,
      phase,
    });
  };
  assertWorkspaceAlchemyVersion(source, version);
  const before = await servedProtocol();
  if (context.target === 'preview' && before !== 8)
    throw new Error('Isolated preview state must already serve protocol 8');
  const baselineVersion = before === 7 ? '2.0.0-beta.83' : version;
  const readArgs =
    context.target === 'preview'
      ? [
          'state',
          'get',
          'state.run.ts',
          '--stack',
          'MaelstromStateStoreCanary',
          '--stage',
          stage,
          '--fqn',
          'Canary',
        ]
      : [
          'state',
          'get',
          'state.run.ts',
          '--stack',
          'MaelstromPlatform',
          '--stage',
          'prod',
          '--fqn',
          'ProductionZone',
        ];
  let bootstrapAttempted = false;
  let needsCleanup = false;
  let failure: unknown;
  const generated = new Set<string>();
  if (context.target === 'preview') {
    for (const root of [control, source]) {
      if (await Bun.file(canaryPath(root)).exists())
        throw new Error('Canary entrypoint already exists');
    }
  }
  try {
    if (context.target === 'preview') {
      const baselineRoot = baselineVersion === version ? source : control;
      await writeFile(
        canaryPath(baselineRoot),
        canarySource(baselineVersion, `${marker}-before`, name),
        { flag: 'wx' },
      );
      generated.add(canaryPath(baselineRoot));
      needsCleanup = true;
      await invoke(
        baselineVersion,
        ['deploy', canaryFile, '--stage', stage, '--yes'],
        'seed-preview-before-upgrade',
      );
    }
    const digest = stateDigest(
      await invoke(
        baselineVersion,
        readArgs,
        'read-existing-state-before-upgrade',
      ),
    );
    await guard();
    if (context.target === 'production') {
      bootstrapAttempted = true;
      await invoke(
        version,
        ['state', 'bootstrap', '--backend', 'cloudflare'],
        'bootstrap-state-store',
      );
    }
    if ((await servedProtocol()) !== 8)
      throw new Error('Bootstrap did not serve protocol 8');
    if (
      digest !==
      stateDigest(
        await invoke(version, readArgs, 'read-existing-state-after-upgrade'),
      )
    )
      throw new Error('Existing encrypted resource changed during bootstrap');
    if (context.target === 'preview') {
      // A pre-upgrade beta.85 retry may already have written this generated file.
      await writeFile(canaryPath(source), canarySource(version, marker, name));
      generated.add(canaryPath(source));
      await invoke(
        version,
        ['deploy', canaryFile, '--stage', stage, '--yes'],
        'deploy-preview-canary',
      );
      let canaryPassed = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const response = await ops.fetch(`https://${name}.${host}`, {
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
          });
          if (response.ok && (await response.text()) === marker) {
            canaryPassed = true;
            break;
          }
        } catch {}
        if (attempt < 11) await ops.sleep(2_500);
      }
      if (!canaryPassed)
        throw new Error('Preview canary did not serve its expected marker');
    } else {
      await invoke(
        version,
        ['deploy', 'alchemy.run.ts', '--stage', 'prod', '--dry-run', '--yes'],
        'production-platform-dry-run',
      );
    }
  } catch (error) {
    failure = error;
  }
  try {
    if (needsCleanup) {
      const cleanupCli = cleanupVersion(
        await servedProtocol(),
        bootstrapAttempted,
      );
      const cleanupRoot = cleanupCli === version ? source : control;
      await writeFile(
        canaryPath(cleanupRoot),
        canarySource(cleanupCli, marker, name),
      );
      generated.add(canaryPath(cleanupRoot));
      await invoke(
        cleanupCli,
        ['destroy', canaryFile, '--stage', stage, '--yes'],
        'cleanup-preview-canary',
        true,
      );
    }
  } catch (cleanupError) {
    const message = (error: unknown) =>
      error instanceof Error ? error.message : String(error);
    const originalFailure =
      failure === undefined ? '' : ` Original failure: ${message(failure)}`;
    failure = new Error(
      `Canary cleanup needs operator repair: stack=MaelstromStateStoreCanary stage=${stage} worker=${name}. Keep all callers paused.${originalFailure} Cleanup failure: ${message(cleanupError)}`,
    );
  }
  const removals = await Promise.allSettled(
    [...generated].map((path) => rm(path, { force: true })),
  );
  if (removals.some((result) => result.status === 'rejected') && !failure)
    failure = new Error('Could not remove generated canary entrypoints');
  if (failure) throw failure;
  const receipt = {
    target: context.target,
    sourceSha: context.sourceSha,
    controlSha: context.controlSha,
    runId: context.runId,
    attempt: context.attempt,
    version,
    protocol: 8,
    storeWorker,
    existingStatePreserved: true,
    canaryPassed: context.target === 'preview',
    cleanupPassed: true,
  };
  await writeFile(
    requiredValue(env, 'RECEIPT_OUTPUT'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: 'wx' },
  );
  console.log('State-store verification passed. Normal callers remain paused.');
}

async function main() {
  const env = process.env;
  const context = maintenanceContext(env);
  if (!env.GH_TOKEN) throw new Error('GitHub read credentials are required');
  const request: GithubRequest = async <T>(path: string) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GH_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`Maintenance lookup failed (${response.status})`);
    return (await response.json()) as T;
  };
  await assertOperator(request, context);
  await assertCandidate(request, context);
  await assertWritersPaused(request);
  if (context.target === 'preview')
    await assertIsolationRun(request, {
      runId: context.isolationRun ?? '',
      controlSha: context.controlSha,
    });
  if (context.target === 'production') {
    const run = await assertPreviewRun(request, context);
    if (process.argv[2] !== 'check') {
      const receipt = await readFile(
        requiredValue(env, 'PREVIEW_RECEIPT'),
        'utf8',
      );
      if (receipt.length > 16_384)
        throw new Error('Preview receipt is too large');
      assertPreviewReceipt(JSON.parse(receipt), context, run);
    }
  }
  if (process.argv[2] === 'check') return;
  if (process.argv[2] !== 'run') throw new Error('Select check or run');
  await executeMaintenance(env, context, request);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Maintenance failed',
    );
    process.exitCode = 1;
  }
}
