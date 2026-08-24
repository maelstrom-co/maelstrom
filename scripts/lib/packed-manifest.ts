import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

/**
 * The trusted package namespace accepted by the privileged publisher. This is
 * deliberately independent of both artifact metadata and workspace discovery.
 */
export const PACKED_PACKAGE_NAMES = Object.freeze([
  '@maelstrom-co/client',
  '@maelstrom-co/connectors',
  '@maelstrom-co/engine',
  '@maelstrom-co/protocol',
  '@maelstrom-co/react',
  '@maelstrom-co/realtime',
  '@maelstrom-co/realtime-livekit',
  '@maelstrom-co/realtime-livekit-agent',
  '@maelstrom-co/realtime-livekit-server',
  '@maelstrom-co/realtime-openai',
  '@maelstrom-co/realtime-openai-server',
  '@maelstrom-co/realtime-protocol',
  '@maelstrom-co/realtime-vad',
  '@maelstrom-co/react-realtime',
] as const);

export const MAX_PACKED_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_OUTPUT_BYTES = 1024 * 1024;
const ARCHIVE_TIMEOUT_MS = 10_000;
const PACKAGE_MANIFEST_MEMBER = 'package/package.json';
const SAFE_TARBALL = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/;

/**
 * The handoff between the two halves of a release. The prepare job packs
 * tarballs from the built tree and writes this alongside them; the publish job
 * validates it against independent trusted inputs before using it.
 */
export type PackedPackage = {
  name: string;
  version: string;
  /** A unique, basename-only `.tgz` filename beside the manifest. */
  tarball: string;
};

export type ValidatedPackedPackage = PackedPackage & {
  /**
   * Canonical path to the original validated tarball. Validation never
   * rewrites, copies, or repacks it.
   */
  tarballPath: string;
};

export type ArchiveProcessRequest = {
  archive: string;
  argv: string[];
  cwd: string;
  env: { LC_ALL: 'C' };
  timeoutMs: number;
  maxOutputBytes: number;
};

export type ArchiveProcessResult = {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
};

type ValidationDependencies = {
  runArchiveProcess?: (request: ArchiveProcessRequest) => ArchiveProcessResult;
};

export const PACKED_MANIFEST_FILENAME = 'packed.json';

function runArchiveProcess(
  request: ArchiveProcessRequest,
): ArchiveProcessResult {
  const result = spawnSync('tar', request.argv, {
    cwd: request.cwd,
    env: { ...process.env, ...request.env },
    maxBuffer: request.maxOutputBytes,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: request.timeoutMs,
  });
  return {
    status: result.status,
    stdout: Buffer.from(result.stdout ?? []),
    stderr: Buffer.from(result.stderr ?? []),
    error: result.error,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parsePackedManifest(
  input: unknown,
  expectedVersion: string,
): PackedPackage[] {
  if (!Array.isArray(input))
    throw new Error('Packed manifest must be an array');
  if (input.length !== PACKED_PACKAGE_NAMES.length) {
    throw new Error(
      `Packed manifest must contain exactly ${PACKED_PACKAGE_NAMES.length} packages`,
    );
  }

  const allowed = new Set<string>(PACKED_PACKAGE_NAMES);
  const names = new Set<string>();
  const tarballs = new Set<string>();
  const packages = input.map((value, index) => {
    const entry = requireRecord(value, `Packed manifest entry ${index}`);
    const keys = Object.keys(entry).sort();
    if (keys.join(',') !== 'name,tarball,version') {
      throw new Error(
        `Packed manifest entry ${index} must contain only name, version, and tarball`,
      );
    }
    const { name, version, tarball } = entry;
    if (
      typeof name !== 'string' ||
      typeof version !== 'string' ||
      typeof tarball !== 'string'
    ) {
      throw new Error(`Packed manifest entry ${index} has invalid field types`);
    }
    if (!allowed.has(name)) {
      throw new Error(
        `Packed manifest entry ${index} names an unknown package`,
      );
    }
    if (names.has(name)) {
      throw new Error(`Packed manifest contains duplicate package: ${name}`);
    }
    if (version !== expectedVersion) {
      throw new Error(
        `Packed manifest version for ${name} does not match the expected version`,
      );
    }
    if (
      !SAFE_TARBALL.test(tarball) ||
      basename(tarball) !== tarball ||
      tarball.startsWith('-')
    ) {
      throw new Error(
        `Packed manifest entry ${index} contains an unsafe tarball basename`,
      );
    }
    if (tarballs.has(tarball)) {
      throw new Error(`Packed manifest contains duplicate tarball: ${tarball}`);
    }
    names.add(name);
    tarballs.add(tarball);
    return { name, version, tarball };
  });

  for (const name of PACKED_PACKAGE_NAMES) {
    if (!names.has(name))
      throw new Error(`Packed manifest is missing package: ${name}`);
  }
  return packages;
}

function assertRegularBoundedFile(path: string) {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(`Tarball is not a regular file: ${path}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Tarball is not a regular file: ${path}`);
  }
  if (stat.size > MAX_PACKED_TARBALL_BYTES) {
    throw new Error(`Tarball exceeds the compressed size limit: ${path}`);
  }
}

function invokeArchive(
  archive: string,
  cwd: string,
  mode: '-tvzf' | '-xOzf',
  execute: (request: ArchiveProcessRequest) => ArchiveProcessResult,
) {
  assertRegularBoundedFile(archive);
  const result = execute({
    archive,
    argv: [mode, archive, PACKAGE_MANIFEST_MEMBER],
    cwd,
    env: { LC_ALL: 'C' },
    timeoutMs: ARCHIVE_TIMEOUT_MS,
    maxOutputBytes: MAX_ARCHIVE_OUTPUT_BYTES,
  });
  if (
    result.error ||
    result.status !== 0 ||
    result.stderr.length !== 0 ||
    result.stdout.length > MAX_ARCHIVE_OUTPUT_BYTES
  ) {
    throw new Error(`Archive inspection failed for ${archive}`);
  }
  return result.stdout;
}

function validateArchive(
  pkg: PackedPackage,
  archive: string,
  cwd: string,
  execute: (request: ArchiveProcessRequest) => ArchiveProcessResult,
) {
  const listing = invokeArchive(archive, cwd, '-tvzf', execute).toString(
    'utf8',
  );
  const lines = listing.split('\n').filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(
      `Archive must contain exactly one literal ${PACKAGE_MANIFEST_MEMBER}`,
    );
  }
  const [line] = lines;
  if (line === undefined) {
    throw new Error(
      `Archive must contain exactly one literal ${PACKAGE_MANIFEST_MEMBER}`,
    );
  }
  const match = line.match(
    /^([-bcdhlps])[rwxStTs-]{9}\s+.*\s(package\/package\.json)(?:\s+(?:->|link to)\s+.*)?$/,
  );
  if (
    !match ||
    match[2] !== PACKAGE_MANIFEST_MEMBER ||
    match[1] !== '-' ||
    !line.endsWith(PACKAGE_MANIFEST_MEMBER)
  ) {
    throw new Error(
      `Archive metadata member must be one regular literal ${PACKAGE_MANIFEST_MEMBER}`,
    );
  }

  const metadataBytes = invokeArchive(archive, cwd, '-xOzf', execute);
  let metadata: Record<string, unknown>;
  try {
    metadata = requireRecord(
      JSON.parse(metadataBytes.toString('utf8')) as unknown,
      'Embedded package manifest',
    );
  } catch (error) {
    throw new Error(`Cannot parse embedded package manifest for ${pkg.name}`, {
      cause: error,
    });
  }
  if (metadata.name !== pkg.name || metadata.version !== pkg.version) {
    throw new Error(
      `Embedded package identity does not match trusted manifest entry for ${pkg.name}`,
    );
  }
}

/**
 * Validates the entire untrusted artifact collection before returning any
 * publishable paths. It confines package identity, version, paths, file types,
 * sizes, and the embedded manifest; it does not attest arbitrary package
 * contents. The returned canonical paths still identify the original tarball
 * bytes produced by the prepare job.
 */
export function validatePackedManifest(
  input: unknown,
  expectedVersion: string,
  directory: string,
  dependencies: ValidationDependencies = {},
): ValidatedPackedPackage[] {
  const packages = parsePackedManifest(input, expectedVersion);
  const cwd = realpathSync(resolve(directory));
  const execute = dependencies.runArchiveProcess ?? runArchiveProcess;
  const validated: ValidatedPackedPackage[] = [];

  for (const pkg of packages) {
    const tarballPath = resolve(cwd, pkg.tarball);
    if (
      !tarballPath.startsWith(`${cwd}${sep}`) ||
      tarballPath !== join(cwd, pkg.tarball)
    ) {
      throw new Error(
        `Tarball resolves outside the artifact directory: ${pkg.tarball}`,
      );
    }
    assertRegularBoundedFile(tarballPath);
    validateArchive(pkg, tarballPath, cwd, execute);
    validated.push({ ...pkg, tarballPath });
  }
  return validated;
}
