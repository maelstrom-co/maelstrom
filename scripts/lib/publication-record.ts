import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { packedIntegrity } from './packed-integrity.ts';
import {
  PACKED_PACKAGE_NAMES,
  type ValidatedPackedPackage,
} from './packed-manifest.ts';

export type PublicationState =
  | 'not_attempted'
  | 'in_flight'
  | 'accepted'
  | 'observed';
export type PublicationContext = {
  repository: string;
  runId: string;
  attempt: number;
  sourceCommit: string;
};
export type PublicationRecording = {
  path: string;
  recoveryDirectory?: string;
  context: PublicationContext;
  freshVersion: boolean;
};
type Entry = {
  name: string;
  integrity: string;
  state: PublicationState;
  updatedAt: string;
};
type RecordFile = PublicationContext & {
  schemaVersion: 1;
  version: string;
  registry: string;
  tag: string;
  packages: Entry[];
};

const states: readonly string[] = [
  'not_attempted',
  'in_flight',
  'accepted',
  'observed',
];
const contextKeys = ['repository', 'runId', 'attempt', 'sourceCommit'] as const;
const recordKeys = [
  'schemaVersion',
  ...contextKeys,
  'version',
  'registry',
  'tag',
  'packages',
];

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new Error('Invalid publication record fields');
  return value as Record<string, unknown>;
}

function canonicalRegistry(registry: string): string {
  let url: URL;
  try {
    url = new URL(registry);
  } catch {
    throw new Error('Invalid publication record registry URL');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Publication records require a credential-free registry URL',
    );
  return url.href.replace(/\/$/, '');
}

function validateContext(context: PublicationContext) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository) ||
    context.repository.length > 201 ||
    !/^[1-9]\d*$/.test(context.runId) ||
    context.runId.length > 32 ||
    !Number.isSafeInteger(context.attempt) ||
    context.attempt <= 0 ||
    !/^[a-f0-9]{40}$/.test(context.sourceCommit)
  )
    throw new Error('Invalid publication workflow identity');
}

function readRecord(path: string): RecordFile {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size === 0 ||
    stat.size > 65_536
  )
    throw new Error('Publication record must be a bounded regular file');
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Cannot parse publication record');
  }
  const record = object(value, recordKeys);
  if (
    record.schemaVersion !== 1 ||
    typeof record.repository !== 'string' ||
    typeof record.runId !== 'string' ||
    typeof record.attempt !== 'number' ||
    typeof record.sourceCommit !== 'string' ||
    typeof record.version !== 'string' ||
    typeof record.registry !== 'string' ||
    typeof record.tag !== 'string' ||
    !Array.isArray(record.packages) ||
    record.packages.length !== PACKED_PACKAGE_NAMES.length ||
    record.version.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(record.tag)
  )
    throw new Error('Invalid publication record values');
  validateContext(record as PublicationContext);
  if (canonicalRegistry(record.registry) !== record.registry)
    throw new Error('Noncanonical publication record registry');
  const names = new Set<string>();
  for (const value of record.packages) {
    const entry = object(value, ['name', 'integrity', 'state', 'updatedAt']);
    if (
      typeof entry.name !== 'string' ||
      !PACKED_PACKAGE_NAMES.some((name) => name === entry.name) ||
      typeof entry.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity) ||
      typeof entry.state !== 'string' ||
      !states.includes(entry.state) ||
      typeof entry.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.updatedAt)) ||
      names.has(entry.name)
    )
      throw new Error('Invalid publication record package');
    names.add(entry.name);
  }
  return record as RecordFile;
}

function recoveryFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw new Error('Invalid publication recovery directory');
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length > 100) throw new Error('Too many publication records');
  return entries.map((entry) => {
    if (entry.isFile() && entry.name === 'publication-record.json')
      return join(directory, entry.name);
    if (
      entry.isDirectory() &&
      /^npm-publication-records-[1-9]\d*$/.test(entry.name)
    )
      return join(directory, entry.name, 'publication-record.json');
    throw new Error('Unexpected publication recovery entry');
  });
}

/** Stores attempt memory; downloaded records never prove registry availability. */
export function createPublicationRecord(
  recording: PublicationRecording,
  packages: readonly ValidatedPackedPackage[],
  target: { version: string; registry: string; tag: string },
) {
  validateContext(recording.context);
  if (
    target.version.length > 128 ||
    target.registry.length > 1024 ||
    !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(target.tag)
  )
    throw new Error('Invalid publication record target');
  const record: RecordFile = {
    schemaVersion: 1,
    repository: recording.context.repository,
    runId: recording.context.runId,
    attempt: recording.context.attempt,
    sourceCommit: recording.context.sourceCommit,
    version: target.version,
    tag: target.tag,
    registry: canonicalRegistry(target.registry),
    packages: packages.map((pkg) => ({
      name: pkg.name,
      integrity: packedIntegrity(pkg),
      state: 'not_attempted',
      updatedAt: new Date().toISOString(),
    })),
  };
  const expected = new Map(record.packages.map((entry) => [entry.name, entry]));
  function entryFor(name: string): Entry {
    const entry = expected.get(name);
    if (!entry) throw new Error('Unknown publication record package');
    return entry;
  }
  const recovered = new Map<string, Entry>();
  const attempts = new Set<number>();
  const previous = recording.recoveryDirectory
    ? recoveryFiles(recording.recoveryDirectory).map(readRecord)
    : [];
  for (const prior of previous.sort((a, b) => a.attempt - b.attempt)) {
    if (
      prior.repository !== record.repository ||
      prior.runId !== record.runId ||
      prior.attempt >= record.attempt
    )
      throw new Error(
        'Publication record belongs to another workflow identity',
      );
    if (prior.version !== record.version) {
      const preview = /^0\.0\.0-pr\.([1-9]\d*)\.([1-9]\d*)\.([1-9]\d*)$/;
      const previousPreview = prior.version.match(preview);
      const currentPreview = record.version.match(preview);
      if (
        !previousPreview ||
        !currentPreview ||
        prior.tag !== record.tag ||
        prior.sourceCommit !== record.sourceCommit ||
        previousPreview[1] !== currentPreview[1] ||
        previousPreview[2] !== currentPreview[2] ||
        Number(previousPreview[3]) > prior.attempt
      )
        throw new Error('Publication record belongs to another version');
      continue;
    }
    if (
      prior.registry !== record.registry ||
      prior.tag !== record.tag ||
      prior.sourceCommit !== record.sourceCommit ||
      prior.packages.length !== record.packages.length ||
      attempts.has(prior.attempt)
    )
      throw new Error('Publication record does not match the release target');
    attempts.add(prior.attempt);
    for (const entry of prior.packages) {
      if (expected.get(entry.name)?.integrity !== entry.integrity)
        throw new Error(
          'Publication record checksum does not match the validated tarball',
        );
      const earlier = recovered.get(entry.name);
      if (
        earlier &&
        earlier.state !== 'not_attempted' &&
        entry.state === 'not_attempted'
      )
        throw new Error(
          'Publication record cannot downgrade an attempted upload',
        );
      if (
        earlier &&
        ['accepted', 'observed'].includes(earlier.state) &&
        !['accepted', 'observed'].includes(entry.state)
      )
        throw new Error(
          'Publication record cannot downgrade an accepted upload',
        );
      recovered.set(entry.name, entry);
    }
  }
  for (const [name, entry] of recovered) Object.assign(entryFor(name), entry);
  if (existsSync(recording.path))
    throw new Error('Publication record output already exists');
  function save() {
    mkdirSync(dirname(recording.path), { recursive: true });
    if (
      existsSync(recording.path) &&
      (!lstatSync(recording.path).isFile() ||
        lstatSync(recording.path).isSymbolicLink())
    )
      throw new Error('Publication output must be a regular file');
    const temporary = `${recording.path}.${randomUUID()}.tmp`;
    try {
      const encoded = `${JSON.stringify(record, null, 2)}\n`;
      if (Buffer.byteLength(encoded) > 65_536)
        throw new Error('Publication record exceeds its size limit');
      writeFileSync(temporary, encoded, {
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporary, recording.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  save();
  return {
    requiresReconciliation: record.attempt > 1 && !recording.freshVersion,
    integrity(name: string) {
      return entryFor(name).integrity;
    },
    accepted(name: string) {
      return ['accepted', 'observed'].includes(entryFor(name).state);
    },
    set(name: string, state: PublicationState) {
      const entry = entryFor(name);
      if (
        ['accepted', 'observed'].includes(entry.state) &&
        !['accepted', 'observed'].includes(state)
      )
        throw new Error('An accepted publication cannot become unattempted');
      Object.assign(entry, { state, updatedAt: new Date().toISOString() });
      save();
    },
  };
}
