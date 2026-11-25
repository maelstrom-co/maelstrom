import { appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  narrationDelivery,
  narrationDeliveryRoutes,
} from './src/NarrationDeliveryContract.js';
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

interface InventoryTarget {
  stack: string;
  stage: Target['stage'];
  fqn: string;
  stateAccountId: string;
}

async function verifyInventory(
  target: InventoryTarget,
  runAlchemy: RunAlchemy,
) {
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

async function readResourceState(
  target: InventoryTarget,
  runAlchemy: RunAlchemy,
) {
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
  if (
    !state ||
    state.fqn !== target.fqn ||
    state.logicalId !== target.fqn ||
    !['created', 'updated'].includes(String(state.status)) ||
    state.providerMode !== 'live' ||
    state.removalPolicy !== 'retain'
  ) {
    throw new Error(
      `Invalid narration resource ownership state for ${target.stack}; investigate an interrupted creation or identity mismatch`,
    );
  }
  return state;
}

async function readState(target: Target, runAlchemy: RunAlchemy) {
  const state = await readResourceState(target, runAlchemy);
  if (!state) return;
  const attr = record(state.attr);
  if (
    !attr ||
    state.resourceType !== 'Cloudflare.R2.Bucket' ||
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

function overlapsNarration(pattern: string) {
  const route = pattern.replace(/^https?:\/\//iu, '');
  const slash = route.indexOf('/');
  if (slash === -1) return false;
  const host = route.slice(0, slash).toLowerCase();
  return (
    route.slice(slash).startsWith(narrationDelivery.path) &&
    narrationDelivery.hosts.some((candidate) =>
      host.startsWith('*')
        ? candidate.endsWith(host.slice(1))
        : candidate === host,
    )
  );
}

const deliveryPatterns = new Set(
  narrationDeliveryRoutes.map(({ pattern }) => pattern),
);
const validId = (id: unknown) =>
  typeof id === 'string' && /^[a-f0-9]{32}$/u.test(id);

function deliveryBindingsMatch(
  bindings: unknown,
  target: InventoryTarget & Pick<Target, 'accountId' | 'bucket'>,
) {
  // beta.85 adds these entries to both script and version uploads.
  const runtime = {
    ALCHEMY_PHASE: 'runtime',
    ALCHEMY_WORKER_NAME: narrationDelivery.name,
    ALCHEMY_STACK_NAME: target.stack,
    ALCHEMY_STAGE: target.stage,
    ALCHEMY_CLOUDFLARE_ACCOUNT_ID: target.accountId,
  };
  if (
    !Array.isArray(bindings) ||
    bindings.length !== Object.keys(runtime).length + 1
  ) {
    return false;
  }

  const entries = bindings.map(record);
  return (
    entries.some(
      (binding) =>
        binding?.name === 'NARRATION_BUCKET' &&
        binding.type === 'r2_bucket' &&
        binding.bucket_name === target.bucket &&
        binding.jurisdiction == null,
    ) &&
    Object.entries(runtime).every(([name, text]) =>
      entries.some(
        (binding) =>
          binding?.name === name &&
          binding.type === 'plain_text' &&
          binding.text === text,
      ),
    )
  );
}

async function inspectDeliveryWorker(
  target: InventoryTarget & Pick<Target, 'accountId' | 'bucket'>,
  deps: Dependencies,
) {
  await verifyInventory(target, deps.runAlchemy);
  const owned = await readResourceState(target, deps.runAlchemy);
  const attr = record(owned?.attr);
  const props = record(owned?.props);
  if (
    owned &&
    (owned.resourceType !== 'Cloudflare.Worker' ||
      props?.name !== narrationDelivery.name ||
      props.workersDev !== false ||
      !isDeepStrictEqual(props.routes, narrationDeliveryRoutes) ||
      attr?.accountId !== target.accountId ||
      attr.workerName !== narrationDelivery.name ||
      attr.domain !== undefined)
  ) {
    throw new Error('Unexpected production narration delivery Worker state');
  }
  const script = `/accounts/${target.accountId}/workers/scripts/${narrationDelivery.name}`;
  const get = async (endpoint: string, allowMissing = false) => {
    const response = await deps.request(
      `https://api.cloudflare.com/client/v4${endpoint}`,
      {
        headers: { authorization: `Bearer ${deps.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    const envelope = record(await response.json());
    const errors = envelope?.errors;
    if (
      allowMissing &&
      response.status === 404 &&
      envelope?.success === false &&
      Array.isArray(errors) &&
      errors.length === 1 &&
      record(errors[0])?.code === 10007
    )
      return;
    const info = record(envelope?.result_info);
    if (
      !response.ok ||
      envelope?.success !== true ||
      !Array.isArray(errors) ||
      errors.length > 0 ||
      (typeof info?.total_pages === 'number' && info.total_pages > 1)
    ) {
      throw new Error(
        `Delivery Worker inspection failed (HTTP ${response.status}, ${endpoint})`,
      );
    }
    return envelope.result;
  };
  const [settingsResult, routes] = await Promise.all([
    get(`${script}/settings`, true),
    get(`/zones/${narrationDelivery.zoneId}/workers/routes`),
  ]);
  const live = record(settingsResult);
  const tags = live?.tags;
  const expectedTags = [
    `alchemy:stack:${target.stack}`,
    `alchemy:stage:${target.stage}`,
    `alchemy:id:${target.fqn}`,
  ];
  if (
    (settingsResult !== undefined && !live) ||
    Boolean(owned) !== Boolean(live) ||
    (live &&
      (!Array.isArray(tags) ||
        !expectedTags.every((tag) => tags.includes(tag)) ||
        !deliveryBindingsMatch(live.bindings, target)))
  ) {
    throw new Error(
      'Production narration delivery Worker ownership or binding mismatch',
    );
  }
  if (!Array.isArray(routes))
    throw new Error('Invalid production Worker route inventory');
  const observed = new Map<string, string>();
  for (const value of routes) {
    const route = record(value);
    if (typeof route?.pattern !== 'string' || typeof route.id !== 'string') {
      throw new Error('Invalid production Worker route');
    }
    if (
      route.script !== narrationDelivery.name &&
      !overlapsNarration(route.pattern)
    )
      continue;
    if (
      !live ||
      route.script !== narrationDelivery.name ||
      !deliveryPatterns.has(route.pattern) ||
      !validId(route.id) ||
      observed.has(route.pattern)
    ) {
      throw new Error(
        `Production narration delivery route collision at ${route.pattern}`,
      );
    }
    observed.set(route.pattern, route.id);
  }
  if (live) {
    const saved = attr?.routes;
    const subdomain = record(await get(`${script}/subdomain`));
    if (
      !Array.isArray(saved) ||
      saved.length !== deliveryPatterns.size ||
      observed.size !== deliveryPatterns.size ||
      !narrationDeliveryRoutes.every(({ pattern, zoneId }) =>
        saved.some((row: unknown) => {
          const route = record(row);
          return (
            route?.zoneId === zoneId &&
            route.pattern === pattern &&
            route.id === observed.get(pattern)
          );
        }),
      ) ||
      subdomain?.enabled !== false ||
      subdomain.previews_enabled !== false
    ) {
      throw new Error(
        'Production narration delivery routes or public endpoints drifted',
      );
    }
  }

  return { owned: Boolean(owned), routes: [...observed].sort() };
}

export async function reconcileProductionDelivery(
  cache: Target,
  deps: Dependencies,
  current: () => Promise<boolean>,
) {
  if (!deps.token || !(await current())) return;
  if (cache.public || cache.accountId !== cache.stateAccountId) {
    throw new Error(
      'Production delivery requires the private production cache',
    );
  }
  if (!(await inspectNarrationStorage(cache, deps))) {
    throw new Error(
      'Private narration cache must be reconciled before configuring delivery',
    );
  }

  const target = { ...cache, ...narrationDelivery };
  const existing = await inspectDeliveryWorker(target, deps);
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
  if (
    (await deps.runAlchemy([...args, '--dry-run'], target.accountId)).code !== 0
  ) {
    throw new Error('Production narration delivery dry run failed');
  }
  if (
    !(await inspectNarrationStorage(cache, deps)) ||
    !isDeepStrictEqual(existing, await inspectDeliveryWorker(target, deps))
  ) {
    throw new Error(
      'Production narration delivery ownership changed during planning',
    );
  }
  if (!(await current())) return;
  if ((await deps.runAlchemy(args, target.accountId)).code !== 0) {
    throw new Error('Production narration delivery apply failed');
  }
  if (!(await inspectDeliveryWorker(target, deps)).owned) {
    throw new Error(
      'Production narration delivery failed post-apply verification',
    );
  }
  return true;
}

async function main() {
  const [command, kind] = Bun.argv.slice(2);
  if (
    (command !== 'discover' && command !== 'reconcile') ||
    (kind !== 'cache' &&
      kind !== 'delivery' &&
      kind !== 'all' &&
      kind !== 'production-delivery') ||
    (command === 'reconcile' && kind === 'all') ||
    (command === 'discover' && kind !== 'cache' && kind !== 'all')
  ) {
    throw new Error(
      'Usage: narration-storage.ts discover cache|all or reconcile cache|delivery|production-delivery',
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
    const current = async () => {
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
    };
    if (kind === 'production-delivery') {
      if (
        await reconcileProductionDelivery(
          narrationTarget('cache'),
          deps,
          current,
        )
      )
        console.log('Verified retained production narration delivery Worker.');
      return;
    }
    const target = narrationTarget(kind as NarrationStorageKind);
    const result = await reconcileNarrationStorage(target, deps, current);
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
