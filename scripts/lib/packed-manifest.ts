import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, type Stats } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * The required package namespace accepted by the privileged publisher. This is
 * deliberately independent of both artifact metadata and workspace discovery.
 */
export const PACKED_PACKAGE_NAMES = Object.freeze([
  '@maelstrom-co/client',
  '@maelstrom-co/connectors',
  '@maelstrom-co/devtools',
  '@maelstrom-co/engine',
  '@maelstrom-co/planner-jev',
  '@maelstrom-co/planner-llm',
  '@maelstrom-co/protocol',
  '@maelstrom-co/react',
  '@maelstrom-co/react-devtools',
  '@maelstrom-co/realtime',
  '@maelstrom-co/realtime-livekit',
  '@maelstrom-co/realtime-livekit-agent',
  '@maelstrom-co/realtime-livekit-server',
  '@maelstrom-co/realtime-openai',
  '@maelstrom-co/realtime-openai-live',
  '@maelstrom-co/realtime-openai-live-server',
  '@maelstrom-co/realtime-openai-server',
  '@maelstrom-co/realtime-protocol',
  '@maelstrom-co/realtime-vad',
  '@maelstrom-co/react-realtime',
  '@maelstrom-co/telemetry',
] as const);

export const MAX_PACKED_TARBALL_BYTES = 50 * 1024 * 1024;
export const MAX_UNPACKED_TARBALL_BYTES = 128 * 1024 * 1024;
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
  mode: '-tzf' | '-tvzf' | '-xOzf',
  execute: (request: ArchiveProcessRequest) => ArchiveProcessResult,
) {
  assertRegularBoundedFile(archive);
  const result = execute({
    archive,
    argv:
      mode === '-xOzf'
        ? [mode, archive, PACKAGE_MANIFEST_MEMBER]
        : [mode, archive],
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

function readTarPathField(header: Buffer, offset: number, length: number) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  if (end !== -1 && field.subarray(end).some((byte) => byte !== 0)) {
    throw new Error(
      'Archive path field has nonzero bytes after its terminator',
    );
  }
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

function inspectCanonicalTarFormat(archive: string) {
  let bytes: Buffer;
  try {
    bytes = gunzipSync(readFileSync(archive), {
      maxOutputLength: MAX_UNPACKED_TARBALL_BYTES,
    });
  } catch (error) {
    throw new Error(`Archive decompression failed for ${archive}`, {
      cause: error,
    });
  }
  if (bytes.length % 512 !== 0) {
    throw new Error(`Archive has an incomplete tar block: ${archive}`);
  }
  const members: { path: string; directory: boolean }[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (
        bytes.length - offset < 1024 ||
        bytes.subarray(offset).some((byte) => byte !== 0)
      ) {
        throw new Error(`Archive has an invalid tar trailer: ${archive}`);
      }
      return members;
    }
    const checksumField = header.subarray(148, 156).toString('utf8');
    let checksum = 8 * 0x20;
    for (const [index, byte] of header.entries()) {
      if (index < 148 || index >= 156) checksum += byte;
    }
    if (
      !/^[0-7]+[ \0]*$/.test(checksumField) ||
      Number.parseInt(checksumField, 8) !== checksum
    ) {
      throw new Error(
        `Archive has an invalid unsigned header checksum: ${archive}`,
      );
    }
    const sizeField = header.subarray(124, 136).toString('utf8');
    const type = header[156];
    // npm and system tar disagree on extension records and nonstandard USTAR versions.
    if (
      header.subarray(257, 265).toString('utf8') !== 'ustar\x0000' ||
      !/^[0-7]{1,11} *\0$/.test(sizeField) ||
      (type !== 0x30 && type !== 0x35)
    ) {
      throw new Error(
        `Archive must contain only canonical USTAR files and directories: ${archive}`,
      );
    }
    const size = Number.parseInt(sizeField, 8);
    if (type === 0x35 && size !== 0) {
      throw new Error(`Archive directory has a payload: ${archive}`);
    }
    const name = readTarPathField(header, 0, 100);
    const prefix = readTarPathField(header, 345, 155);
    const member = prefix ? `${prefix}/${name}` : name;
    const directory = type === 0x35;
    const path = directory ? member.slice(0, -1) : member;
    const segments = path.split('/');
    // Canonical ASCII paths avoid tar quoting and npm's strip-one aliases.
    if (
      !name ||
      directory !== member.endsWith('/') ||
      segments[0] !== 'package' ||
      (segments.length === 1 && !directory) ||
      segments.some(
        (segment) =>
          !/^[A-Za-z0-9@._+-]+$/.test(segment) ||
          segment === '.' ||
          segment === '..',
      ) ||
      seen.has(path)
    ) {
      throw new Error(
        `Archive contains an unsafe or duplicate path: ${member}`,
      );
    }
    seen.add(path);
    members.push({ path: member, directory });
    offset += 512 + Math.ceil(size / 512) * 512;
    if (offset > bytes.length) {
      throw new Error(`Archive has a truncated member: ${archive}`);
    }
  }
  throw new Error(`Archive is missing its tar trailer: ${archive}`);
}

function validateArchive(
  pkg: PackedPackage,
  archive: string,
  cwd: string,
  execute: (request: ArchiveProcessRequest) => ArchiveProcessResult,
) {
  const expectedMembers = inspectCanonicalTarFormat(archive);
  const members = invokeArchive(archive, cwd, '-tzf', execute)
    .toString('utf8')
    .split('\n');
  const listing = invokeArchive(archive, cwd, '-tvzf', execute)
    .toString('utf8')
    .split('\n');
  if (
    members.pop() !== '' ||
    listing.pop() !== '' ||
    members.length === 0 ||
    members.length !== listing.length ||
    members.length !== expectedMembers.length
  ) {
    throw new Error(`Archive member listing is invalid for ${pkg.name}`);
  }
  let manifests = 0;
  for (const [index, member] of members.entries()) {
    const expected = expectedMembers[index];
    if (!expected || member !== expected.path) {
      throw new Error(
        `Archive listing does not match its raw headers: ${archive}`,
      );
    }
    const line = listing[index];
    if (
      !line ||
      !/^[-d][rwxStTs-]{9}\s/.test(line) ||
      line[0] !== (expected.directory ? 'd' : '-') ||
      !line.endsWith(` ${member}`)
    ) {
      throw new Error(
        `Archive member must be a regular file or directory: ${member}`,
      );
    }
    if (member === PACKAGE_MANIFEST_MEMBER) manifests++;
  }
  if (manifests !== 1) {
    throw new Error(
      `Archive must contain exactly one regular literal ${PACKAGE_MANIFEST_MEMBER}`,
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
  if (metadata.publishConfig !== undefined) {
    const config = requireRecord(
      metadata.publishConfig,
      'Embedded publishConfig',
    );
    if (
      Object.keys(config).some(
        (key) => key !== 'registry' && key !== 'access',
      ) ||
      config.registry !== 'https://registry.npmjs.org' ||
      config.access !== 'public'
    ) {
      // npm applies arbitrary publishConfig keys to credential-bearing requests.
      throw new Error(`Unsafe embedded publishConfig for ${pkg.name}`);
    }
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
