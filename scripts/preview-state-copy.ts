import { createHash } from 'node:crypto';

import {
  OSS_PREVIEW_STACKS,
  OSS_PREVIEW_STAGE_PATTERN,
} from '../infra/platform/src/PreviewStateStoreContract.ts';

/** JSON encoding transported by the state API, without reviving library markers. */
export type WireValue =
  | null
  | boolean
  | number
  | string
  | WireValue[]
  | { [key: string]: WireValue };

/** An explicitly selected state namespace. */
export interface PreviewScope {
  /** Exact stack allowlist member; never a prefix match. */
  readonly stack: string;
  /** Canonical PR stage. */
  readonly stage: string;
}

/** Logical key independent of the store's physical location. */
export interface PreviewStateKey extends PreviewScope {
  /** Complete namespace-qualified resource identity. */
  readonly fqn: string;
}

/** Read capabilities only; the source deliberately has no mutation methods. */
export interface PreviewStateReader {
  /** Observed wire protocol of this exact endpoint. */
  version(): Promise<number>;
  /** Full backend stack index, used to detect foreign destination state. */
  stacks(): Promise<readonly string[]>;
  /** Resource-bearing stages; outputs-only stages need the explicit manifest. */
  stages(stack: string): Promise<readonly string[]>;
  /** Complete resource inventory for one selected scope. */
  keys(scope: PreviewScope): Promise<readonly string[]>;
  /** Missing listed rows are a consistency failure. */
  get(key: PreviewStateKey): Promise<WireValue | undefined>;
  /** An absent output differs from a persisted JSON null. */
  output(scope: PreviewScope): Promise<WireValue | undefined>;
}

/** Destination capabilities used only after an absent-target check. */
export interface PreviewStateDestination extends PreviewStateReader {
  /** Must distinguish absent Worker from authentication or transport failure. */
  exists(): Promise<boolean>;
  /** Creates only the fixed named backend; never reconciles application resources. */
  initialize(scopes: readonly PreviewScope[]): Promise<void>;
  /** Writes the complete encoded row without projecting fields. */
  put(key: PreviewStateKey, value: WireValue): Promise<void>;
  /** Preserves cross-stack reference output separately from resources. */
  putOutput(scope: PreviewScope, value: WireValue): Promise<void>;
}

/** Evidence used to enumerate active and historical repository preview stages. */
export interface PreviewCopyManifest {
  /** All repository PR numbers, including closed PRs, from a paginated query. */
  readonly pullNumbers: readonly string[];
  /** Complete live Worker names; current names require source ownership state. */
  readonly workerNames: readonly string[];
  /** Additional known manual stages, including outputs-only stages. */
  readonly additionalStages?: readonly string[];
}

interface StageSnapshot extends PreviewScope {
  readonly rows: readonly { readonly fqn: string; readonly value: WireValue }[];
  readonly output: WireValue | undefined;
}

/** Redacted proof; no state contents or data-derived hashes leave the process. */
export interface PreviewCopyProof {
  /** Number of fully compared resource rows, including action and replacement rows. */
  readonly resources: number;
  /** Number of separately compared persisted outputs. */
  readonly outputs: number;
  /** Selected nonempty stage counts, not their sensitive contents. */
  readonly scopes: readonly {
    readonly stack: string;
    readonly stage: string;
    readonly resources: number;
    readonly output: boolean;
  }[];
  /** Legacy Wrangler previews have no Alchemy ownership records to migrate. */
  readonly legacyWorkers: number;
  /** Source snapshot remained equal after all destination writes. */
  readonly sourceUnchanged: true;
  /** Exact selected row and output inventories matched on re-read. */
  readonly manifestVerified: true;
  /** No preexisting destination was adopted or overwritten. */
  readonly destinationWasAbsent: true;
}

const MAX_ENTRIES = 1000;
const MAX_BYTES = 16 * 1024 * 1024;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fail(code: string): never {
  throw new Error(code);
}

function assertScope(scope: PreviewScope) {
  if (
    !OSS_PREVIEW_STACKS.some((item) => item.stack === scope.stack) ||
    !OSS_PREVIEW_STAGE_PATTERN.test(scope.stage)
  )
    fail('PREVIEW_SCOPE_REJECTED');
}

function strings(values: readonly string[]) {
  if (
    values.length >= MAX_ENTRIES ||
    values.some(
      (value) =>
        typeof value !== 'string' || value.length === 0 || value.includes('\0'),
    ) ||
    new Set(values).size !== values.length
  )
    fail('PREVIEW_INVENTORY_INCOMPLETE');
  return [...values].sort();
}

function assertWire(
  value: unknown,
  depth = 0,
  parents = new Set<object>(),
): asserts value is WireValue {
  if (depth > 128) fail('PREVIEW_VALUE_LIMIT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null || parents.has(value))
    fail('PREVIEW_VALUE_REJECTED');
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    fail('PREVIEW_VALUE_REJECTED');
  parents.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertWire(child, depth + 1, parents);
  } else {
    if (!object(value)) fail('PREVIEW_VALUE_REJECTED');
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail('PREVIEW_VALUE_REJECTED');
    const keys = Object.keys(value);
    if (
      keys.length === 1 &&
      keys[0] === '__bytes__' &&
      typeof value.__bytes__ === 'string'
    )
      fail('PREVIEW_NEW_MARKER_COLLISION');
    for (const child of Object.values(value))
      assertWire(child, depth + 1, parents);
  }
  parents.delete(value);
}

/** Validates and freezes a raw API value without reviving serialized marker envelopes. */
export function previewWireValue(value: unknown): WireValue | undefined {
  if (value === undefined) return undefined;
  assertWire(value);
  return structuredClone(value);
}

const clone = previewWireValue;

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('PREVIEW_VALUE_REJECTED');
  return encoded;
}

const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');

function ownsWorker(value: unknown, name: string): boolean {
  if (!object(value) || value.kind === 'action') return false;
  if (object(value.attr) && value.attr.workerName === name) return true;
  return object(value.old) && ownsWorker(value.old, name);
}

function workerStages(manifest: PreviewCopyManifest) {
  const result = new Map<string, Set<string>>();
  const current = new Map<string, string>();
  let legacy = 0;
  for (const entry of OSS_PREVIEW_STACKS) result.set(entry.stack, new Set());
  for (const name of manifest.workerNames) {
    for (const entry of OSS_PREVIEW_STACKS) {
      const match = name.match(
        new RegExp(`^${entry.workerPrefix}(-alchemy)?-(pr-[1-9]\\d*)$`),
      );
      if (!match?.[2]) continue;
      result.get(entry.stack)?.add(match[2]);
      if (match[1]) current.set(`${entry.stack}/${match[2]}`, name);
      else legacy++;
    }
  }
  return { stages: result, current, legacy };
}

/** Captures API-visible state for the explicit repository/live-stage manifest. */
export async function snapshotPreviewState(
  source: PreviewStateReader,
  manifest: PreviewCopyManifest,
) {
  strings(await source.stacks());
  const pulls = strings(manifest.pullNumbers);
  if (pulls.some((number) => !/^[1-9]\d*$/.test(number)))
    fail('PREVIEW_PR_MANIFEST_REJECTED');
  const additional = strings(manifest.additionalStages ?? []);
  if (additional.some((stage) => !OSS_PREVIEW_STAGE_PATTERN.test(stage)))
    fail('PREVIEW_STAGE_MANIFEST_REJECTED');
  const workers = workerStages(manifest);
  const snapshots: StageSnapshot[] = [];
  let mutations = 0;
  let bytes = 2;
  const retain = (value: unknown) => {
    mutations++;
    bytes += Buffer.byteLength(canonical(value)) + 128;
    if (mutations > MAX_ENTRIES || bytes > MAX_BYTES)
      fail('PREVIEW_SNAPSHOT_LIMIT');
  };
  for (const entry of OSS_PREVIEW_STACKS) {
    const listed = strings(await source.stages(entry.stack));
    if (listed.some((stage) => !OSS_PREVIEW_STAGE_PATTERN.test(stage)))
      fail('PREVIEW_STAGE_MANIFEST_REJECTED');
    const resourceStages = new Set(listed);
    const stages = strings([
      ...new Set([
        ...listed,
        ...pulls.map((number) => `pr-${number}`),
        ...additional,
        ...(workers.stages.get(entry.stack) ?? []),
      ]),
    ]);
    for (const stage of stages) {
      const scope = { stack: entry.stack, stage };
      assertScope(scope);
      const live = workers.current.get(`${scope.stack}/${scope.stage}`);
      const fqns =
        resourceStages.has(stage) || live
          ? strings(await source.keys(scope))
          : [];
      if (mutations + fqns.length > MAX_ENTRIES) fail('PREVIEW_SNAPSHOT_LIMIT');
      const rows = [];
      for (const fqn of fqns) {
        const value = clone(await source.get({ ...scope, fqn }));
        if (value === undefined) fail('PREVIEW_LISTED_ROW_MISSING');
        retain({ ...scope, fqn, value });
        rows.push({ fqn, value });
      }
      if (live && !rows.some((row) => ownsWorker(row.value, live)))
        fail('PREVIEW_LIVE_WORKER_STATE_MISSING');
      const output = clone(await source.output(scope));
      if (output !== undefined) retain({ ...scope, output });
      if (rows.length || output !== undefined)
        snapshots.push({ ...scope, rows, output });
    }
  }
  return { snapshots, legacy: workers.legacy };
}

/** Copies into a fresh isolated store; failure never removes or overwrites source state. */
export async function copyPreviewState(
  source: PreviewStateReader,
  destination: PreviewStateDestination,
  manifest: PreviewCopyManifest,
  guard: () => Promise<void>,
): Promise<PreviewCopyProof> {
  await guard();
  if ((await source.version()) !== 7) fail('PREVIEW_SOURCE_PROTOCOL_REJECTED');
  if (await destination.exists()) fail('PREVIEW_DESTINATION_ALREADY_EXISTS');
  const before = await snapshotPreviewState(source, manifest);
  await guard();
  await destination.initialize(before.snapshots);
  if (
    (await destination.version()) !== 8 ||
    (await destination.stacks()).length !== 0
  )
    fail('PREVIEW_DESTINATION_NOT_EMPTY');
  const mutations: Array<() => Promise<void>> = [];
  for (const scope of before.snapshots) {
    for (const row of scope.rows)
      mutations.push(() =>
        destination.put(
          { stack: scope.stack, stage: scope.stage, fqn: row.fqn },
          row.value,
        ),
      );
  }
  for (const scope of before.snapshots) {
    if (scope.output !== undefined) {
      const value = scope.output;
      mutations.push(() =>
        destination.putOutput(
          { stack: scope.stack, stage: scope.stage },
          value,
        ),
      );
    }
  }
  for (let start = 0; start < mutations.length; start += 100) {
    await guard();
    for (let i = start; i < Math.min(start + 100, mutations.length); i += 4) {
      const results = await Promise.allSettled(
        mutations
          .slice(i, Math.min(i + 4, start + 100))
          .map((write) => write()),
      );
      if (results.some((result) => result.status === 'rejected'))
        fail('PREVIEW_COPY_WRITE_FAILED');
    }
  }
  await guard();
  const targetStacks = strings(await destination.stacks());
  if (
    targetStacks.some(
      (stack) => !OSS_PREVIEW_STACKS.some((allowed) => allowed.stack === stack),
    )
  )
    fail('PREVIEW_DESTINATION_FOREIGN_STATE');
  const copied = await snapshotPreviewState(destination, {
    ...manifest,
    workerNames: [],
  });
  if (
    (await destination.version()) !== 8 ||
    digest(before.snapshots) !== digest(copied.snapshots)
  )
    fail('PREVIEW_COPY_VERIFICATION_FAILED');
  const after = await snapshotPreviewState(source, manifest);
  if (
    (await source.version()) !== 7 ||
    digest(before.snapshots) !== digest(after.snapshots)
  )
    fail('PREVIEW_SOURCE_CHANGED');
  await guard();
  return {
    resources: before.snapshots.reduce((n, stage) => n + stage.rows.length, 0),
    outputs: before.snapshots.filter((stage) => stage.output !== undefined)
      .length,
    scopes: before.snapshots.map((scope) => ({
      stack: scope.stack,
      stage: scope.stage,
      resources: scope.rows.length,
      output: scope.output !== undefined,
    })),
    legacyWorkers: before.legacy,
    sourceUnchanged: true,
    manifestVerified: true,
    destinationWasAbsent: true,
  };
}
