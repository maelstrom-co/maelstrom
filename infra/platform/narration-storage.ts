import { appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { narrationBucketProps } from './src/NarrationStorage.js';
import {
  narrationInspectionEntrypoint,
  narrationProfile,
  narrationTarget,
  type NarrationStorageKind,
} from './src/NarrationStorageContract.js';

type Target = ReturnType<typeof narrationTarget>;
type RunAlchemy = (
  args: readonly string[],
  accountId: string,
) => Promise<{ code: number; stdout: string }>;
type Request = (url: string, init: RequestInit) => Promise<Response>;
type RecordValue = Record<string, unknown>;

interface Dependencies {
  runAlchemy: RunAlchemy;
  request: Request;
  token: string;
}

const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;

const publicHostname = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.r2\.dev$/u;
const isPublicHostname = (value: unknown): value is string =>
  typeof value === 'string' && publicHostname.exec(value)?.[0] === value;

async function verifyInventory(target: Target, runAlchemy: RunAlchemy) {
  const { code, stdout } = await runAlchemy(
    [
      'state',
      'inventory',
      narrationInspectionEntrypoint,
      '--stack',
      target.stack,
      '--stage',
      target.stage,
      '--profile',
      narrationProfile,
    ],
    target.stateAccountId,
  );
  if (code !== 0) {
    throw new Error(
      `Narration state inventory failed for ${target.stack} (exit ${code})`,
    );
  }
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    throw new Error(`Malformed narration state inventory for ${target.stack}`);
  }
  if (
    !Array.isArray(rows) ||
    rows.length > 1 ||
    rows.some((row) => row !== target.fqn)
  ) {
    throw new Error(
      `Unexpected resource in narration state inventory for ${target.stack}`,
    );
  }
}

async function readState(target: Target, runAlchemy: RunAlchemy) {
  const { code, stdout } = await runAlchemy(
    [
      'state',
      'get',
      narrationInspectionEntrypoint,
      '--stack',
      target.stack,
      '--stage',
      target.stage,
      '--fqn',
      target.fqn,
      '--profile',
      narrationProfile,
    ],
    target.stateAccountId,
  );
  if (code !== 0)
    throw new Error(
      `Narration state read failed for ${target.stack} (exit ${code})`,
    );
  if (stdout === `(not found: ${target.stack}/${target.stage}/${target.fqn})\n`)
    return;
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`Malformed narration state output for ${target.stack}`);
  }
  const state = record(data);
  const attr = record(state?.attr);
  if (
    !state ||
    !attr ||
    state.resourceType !== 'Cloudflare.R2.Bucket' ||
    state.fqn !== target.fqn ||
    state.logicalId !== target.fqn ||
    !['created', 'updated'].includes(String(state.status)) ||
    state.providerMode !== 'live' ||
    state.removalPolicy !== 'retain' ||
    record(state.props)?.name !== target.bucket ||
    attr.accountId !== target.accountId ||
    attr.bucketName !== target.bucket
  ) {
    throw new Error(
      `Invalid narration bucket ownership state for ${target.stack}; investigate an interrupted creation or identity mismatch`,
    );
  }
  return {
    props: state.props,
    attr,
    account: attr.accountId,
    bucket: attr.bucketName,
  };
}

async function observeBucket(target: Target, deps: Dependencies) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/r2/buckets/${target.bucket}`;
  const get = async (path: string, absentCode?: number) => {
    const response = await deps.request(endpoint + path, {
      headers: { authorization: `Bearer ${deps.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        `Narration bucket inspection denied for ${target.stack} (HTTP ${response.status})`,
      );
    }
    const envelope = record(await response.json());
    const errors = envelope?.errors;
    if (
      (response.status === 404 ||
        (absentCode === 10059 && response.status === 400)) &&
      absentCode &&
      envelope?.success === false &&
      Array.isArray(errors) &&
      errors.length === 1 &&
      record(errors[0])?.code === absentCode
    )
      return undefined;
    const result = record(envelope?.result);
    if (
      !response.ok ||
      envelope?.success !== true ||
      !result ||
      !Array.isArray(errors) ||
      errors.length !== 0
    ) {
      throw new Error(
        `Narration bucket inspection failed for ${target.stack} (HTTP ${response.status}, ${path || 'bucket'})`,
      );
    }
    return result;
  };

  const bucket = await get('', 10006);
  if (!bucket) return;
  if (
    bucket.name !== target.bucket ||
    (bucket.jurisdiction ?? 'default') !== 'default'
  ) {
    throw new Error(
      `Unexpected Cloudflare bucket identity for ${target.stack}`,
    );
  }

  return { get };
}

const headerValues = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.map((item: string) => item.toLowerCase()).sort()
    : undefined;
const headersMatch = (actual: unknown, saved: unknown) => {
  const expected = headerValues(saved);
  return (
    expected !== undefined && isDeepStrictEqual(headerValues(actual), expected)
  );
};

async function verifyConfiguration(
  target: Target,
  state: NonNullable<Awaited<ReturnType<typeof readState>>>,
  observed: NonNullable<Awaited<ReturnType<typeof observeBucket>>>,
  requireDesired: boolean,
) {
  const expected = record(state.props);
  const [managed, custom, lifecycle, cors] = await Promise.all([
    observed.get('/domains/managed'),
    observed.get('/domains/custom'),
    observed.get('/lifecycle'),
    observed.get('/cors', 10059),
  ]);
  const drift = () =>
    new Error(`Narration storage configuration drift for ${target.stack}`);
  const rules = lifecycle?.rules ?? [];
  const corsRules = cors?.rules ?? [];
  const expectedCors = expected?.cors;
  const expectedRules = expected?.lifecycleRules;
  if (
    (requireDesired &&
      !isDeepStrictEqual(
        expected,
        narrationBucketProps(target.public ? 'delivery' : 'cache'),
      )) ||
    expected?.publicAccess !== target.public ||
    expected.forceDestroy !== false ||
    !isDeepStrictEqual(expected.domains, []) ||
    !isDeepStrictEqual(state.attr.domains, []) ||
    !isDeepStrictEqual(state.attr.lifecycleRules, expectedRules) ||
    !isDeepStrictEqual(state.attr.cors, expectedCors) ||
    managed?.enabled !== target.public ||
    !isDeepStrictEqual(custom?.domains, []) ||
    !Array.isArray(rules) ||
    !Array.isArray(corsRules) ||
    !Array.isArray(expectedRules) ||
    !Array.isArray(expectedCors) ||
    rules.length !== expectedRules.length ||
    corsRules.length !== expectedCors.length
  )
    throw drift();

  if (!target.public) {
    if (
      state.attr.publicDomain !== undefined ||
      rules.length !== 0 ||
      corsRules.length !== 0
    )
      throw drift();
    return undefined;
  }

  if (
    !isPublicHostname(managed.domain) ||
    state.attr.publicDomain !== managed.domain
  )
    throw drift();

  for (const [index, value] of expectedRules.entries()) {
    const saved = record(value);
    const rule = record(rules[index]);
    if (
      !saved ||
      !rule ||
      rule.id !== saved.id ||
      rule.enabled !== saved.enabled ||
      record(rule.conditions)?.prefix !== saved.prefix ||
      !isDeepStrictEqual(
        rule.deleteObjectsTransition ?? undefined,
        saved.deleteObjectsTransition,
      ) ||
      !isDeepStrictEqual(
        rule.abortMultipartUploadsTransition ?? undefined,
        saved.abortMultipartUploadsTransition,
      ) ||
      !isDeepStrictEqual(
        rule.storageClassTransitions ?? [],
        saved.storageClassTransitions ?? [],
      )
    ) {
      throw drift();
    }
  }
  for (const [index, value] of expectedCors.entries()) {
    const saved = record(value);
    const rule = record(corsRules[index]);
    const allowed = record(rule?.allowed);
    if (
      !saved ||
      !rule ||
      rule.id !== saved.id ||
      rule.maxAgeSeconds !== saved.maxAgeSeconds ||
      !headersMatch(allowed?.methods, saved.allowedMethods) ||
      !headersMatch(allowed?.origins, saved.allowedOrigins) ||
      !headersMatch(allowed?.headers, saved.allowedHeaders) ||
      !headersMatch(rule.exposeHeaders, saved.exposeHeaders)
    ) {
      throw drift();
    }
  }

  return `https://${managed.domain}`;
}

export async function inspectNarrationStorage(
  target: Target,
  deps: Dependencies,
  requireDesired = true,
) {
  if (!deps.token) return;
  const state = await readState(target, deps.runAlchemy);
  const observed = await observeBucket(target, deps);
  if (!state && !observed) return;
  if (!state)
    throw new Error(`Unmanaged narration bucket collision for ${target.stack}`);
  if (!observed)
    throw new Error(`Managed narration bucket is missing for ${target.stack}`);
  const origin = await verifyConfiguration(
    target,
    state,
    observed,
    requireDesired,
  );
  return {
    account: state.account,
    bucket: state.bucket,
    origin,
  };
}

export async function reconcileNarrationStorage(
  target: Target,
  deps: Dependencies,
  current: () => Promise<boolean>,
) {
  if (!deps.token || !(await current())) return;
  await verifyInventory(target, deps.runAlchemy);
  const existing = await inspectNarrationStorage(target, deps, false);
  const args = [
    'deploy',
    target.entrypoint,
    '--stage',
    target.stage,
    '--profile',
    narrationProfile,
    '--include',
    target.fqn,
    '--yes',
  ];
  const plan = await deps.runAlchemy([...args, '--dry-run'], target.accountId);
  if (plan.code !== 0)
    throw new Error(`Narration storage dry run failed for ${target.stack}`);
  await verifyInventory(target, deps.runAlchemy);
  const beforeApply = await inspectNarrationStorage(target, deps, false);
  if (!isDeepStrictEqual(existing, beforeApply)) {
    throw new Error(
      `Narration storage ownership changed during planning for ${target.stack}`,
    );
  }
  if (!(await current())) return;
  const apply = await deps.runAlchemy(args, target.accountId);
  if (apply.code !== 0)
    throw new Error(`Narration storage apply failed for ${target.stack}`);
  const verified = await inspectNarrationStorage(target, deps);
  if (!verified)
    throw new Error(
      `Narration storage failed post-apply verification for ${target.stack}`,
    );
  if (verified.origin) {
    const response = await deps.request(
      `${verified.origin}/.maelstrom-narration-verification/${crypto.randomUUID()}`,
      {
        method: 'HEAD',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 404) {
      throw new Error(
        `Narration public delivery probe failed (HTTP ${response.status})`,
      );
    }
  }
  return verified;
}

async function main() {
  const [command, kind] = Bun.argv.slice(2);
  if (
    (command !== 'discover' && command !== 'reconcile') ||
    (kind !== 'cache' && kind !== 'delivery' && kind !== 'all') ||
    (command === 'reconcile' && kind === 'all') ||
    (command === 'discover' && kind === 'delivery')
  ) {
    throw new Error(
      'Usage: narration-storage.ts discover cache|all or reconcile cache|delivery',
    );
  }
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.log(
      'Narration storage is disabled until the management identity is configured.',
    );
    return;
  }

  const deps: Dependencies = {
    token,
    request: fetch,
    async runAlchemy(args, accountId) {
      const env = {
        ...process.env,
        GH_TOKEN: undefined,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        ALCHEMY_PROFILE: narrationProfile,
        CI: 'true',
      };
      const result = Bun.spawn(['bun', '--no-env-file', 'alchemy', ...args], {
        cwd: import.meta.dir,
        env,
        stdout: args[0] === 'state' ? 'pipe' : 'inherit',
        stderr: 'inherit',
        timeout: 120_000,
      });
      const stdout = result.stdout
        ? await new Response(result.stdout).text()
        : '';
      return { code: await result.exited, stdout };
    },
  };
  if (command === 'reconcile') {
    const target = narrationTarget(kind as NarrationStorageKind);
    const result = await reconcileNarrationStorage(target, deps, async () => {
      const expected = process.env.DEPLOY_SHA;
      if (!expected || !/^[a-f0-9]{40}$/u.test(expected))
        throw new Error('Missing trusted deployment revision');
      const revision = Bun.spawn(
        ['bun', '--no-env-file', 'scripts/latest-green-ci.ts'],
        {
          cwd: `${import.meta.dir}/../..`,
          env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined },
          stdout: 'pipe',
          stderr: 'inherit',
          timeout: 120_000,
        },
      );
      const latest = (await new Response(revision.stdout).text()).trim();
      if ((await revision.exited) !== 0)
        throw new Error('Narration revision check failed');
      if (latest !== expected)
        console.log('Skipping superseded narration storage reconciliation.');
      return latest === expected;
    });
    if (result)
      console.log(`Verified retained narration storage for ${target.stack}.`);
    return;
  }

  const cache = await inspectNarrationStorage(narrationTarget('cache'), deps);
  const delivery =
    kind === 'all'
      ? await inspectNarrationStorage(narrationTarget('delivery'), deps)
      : undefined;
  if (!cache || (kind === 'all' && !delivery)) {
    console.log(
      'Narration storage has not been reconciled yet. The website can deploy without it.',
    );
    return;
  }
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(output, `cache-bucket=${cache.bucket}\n`);
  if (delivery) {
    appendFileSync(
      output,
      `delivery-bucket=${delivery.bucket}\norigin=${delivery.origin}\n`,
    );
  }
}

if (import.meta.main) await main();
