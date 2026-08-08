import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKED_MANIFEST_FILENAME, PACKED_PACKAGE_NAMES, type ArchiveProcessRequest } from './lib/packed-manifest.ts';
import { parsePublishArgs, publishTarballs } from './publish-tarballs.ts';

function withArtifact(run: (dir: string, log: string[]) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'maelstrom-publisher-'));
  const log: string[] = [];
  const packages = PACKED_PACKAGE_NAMES.map((name, index) => ({ name, version: '1.2.3', tarball: `package-${index}.tgz` }));
  for (const pkg of packages) writeFileSync(join(dir, pkg.tarball), 'fixture');
  writeFileSync(join(dir, PACKED_MANIFEST_FILENAME), JSON.stringify(packages));
  try {
    run(dir, log);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function archiveProcess(log: string[]) {
  return (request: ArchiveProcessRequest) => {
    const index = Number(request.archive.match(/(\d+)\.tgz$/)?.[1]);
    const pkg = PACKED_PACKAGE_NAMES[index]!;
    log.push(`${request.argv[0] === '-tvzf' ? 'list' : 'read'}:${pkg}`);
    return request.argv[0] === '-tvzf'
      ? { status: 0, stdout: Buffer.from('-rw-r--r-- 0 0 0 42 Jan 1 00:00 package/package.json\n'), stderr: Buffer.alloc(0) }
      : { status: 0, stdout: Buffer.from(JSON.stringify({ name: pkg, version: '1.2.3' })), stderr: Buffer.alloc(0) };
  };
}

describe('parsePublishArgs', () => {
  test('requires exactly one canonical expected version', () => {
    expect(parsePublishArgs(['--tag', 'latest', '--expected-version', '1.2.3'], '/repo').expectedVersion).toBe('1.2.3');
    for (const args of [
      ['--tag', 'latest'],
      ['--tag', 'latest', '--expected-version'],
      ['--tag', 'latest', '--expected-version', '--dry-run'],
      ['--tag', 'latest', '--expected-version', '01.2.3'],
      ['--tag', 'latest', '--expected-version', '1.2.3', '--expected-version', '1.2.3'],
    ]) expect(() => parsePublishArgs(args, '/repo')).toThrow('expected-version');
  });
});

describe('publishTarballs', () => {
  test('validates the complete collection before the first registry probe', () => withArtifact((dir, log) => {
    publishTarballs({ dir, tag: 'latest', registry: 'https://example.test', expectedVersion: '1.2.3', dryRun: false, provenance: false, skipPublished: true }, {
      runArchiveProcess: archiveProcess(log),
      isAlreadyPublished: (name) => { log.push(`probe:${name}`); return true; },
      publish: (_tarball, pkg) => log.push(`publish:${pkg.name}`),
    });
    expect(log.filter((event) => event.startsWith('read:'))).toHaveLength(10);
    expect(log.findIndex((event) => event.startsWith('probe:'))).toBe(20);
    expect(log.some((event) => event.startsWith('publish:'))).toBe(false);
  }));

  test('does not probe or publish when the tenth archive is invalid', () => withArtifact((dir, log) => {
    const runArchiveProcess = archiveProcess(log);
    expect(() => publishTarballs({ dir, tag: 'latest', registry: 'https://example.test', expectedVersion: '1.2.3', dryRun: false, provenance: false, skipPublished: true }, {
      runArchiveProcess: (request) => request.archive.endsWith('9.tgz') && request.argv[0] === '-xOzf'
        ? { status: 0, stdout: Buffer.from('{}'), stderr: Buffer.alloc(0) }
        : runArchiveProcess(request),
      isAlreadyPublished: (name) => { log.push(`probe:${name}`); return false; },
      publish: (_tarball, pkg) => log.push(`publish:${pkg.name}`),
    })).toThrow();
    expect(log.some((event) => event.startsWith('probe:') || event.startsWith('publish:'))).toBe(false);
  }));

  test('revalidates changed artifact bytes before skipping a rerun', () => withArtifact((dir, log) => {
    const options = { dir, tag: 'latest', registry: 'https://example.test', expectedVersion: '1.2.3', dryRun: false, provenance: false, skipPublished: true };
    const dependencies = {
      runArchiveProcess: archiveProcess(log),
      isAlreadyPublished: (name: string) => { log.push(`probe:${name}`); return true; },
      publish: (_tarball: string, pkg: { name: string }) => log.push(`publish:${pkg.name}`),
    };
    publishTarballs(options, dependencies);
    writeFileSync(join(dir, 'package-0.tgz'), 'changed bytes');
    log.push('rerun');
    publishTarballs(options, dependencies);
    const rerun = log.indexOf('rerun');
    expect(log.slice(rerun + 1).findIndex((event) => event.startsWith('probe:'))).toBe(20);
  }));

  test('preserves partial reruns and stops on an indeterminate probe', () => withArtifact((dir, log) => {
    let probe = 0;
    expect(() => publishTarballs({ dir, tag: 'latest', registry: 'https://example.test', expectedVersion: '1.2.3', dryRun: false, provenance: false, skipPublished: true }, {
      runArchiveProcess: archiveProcess(log),
      isAlreadyPublished: (name) => {
        log.push(`probe:${name}`);
        probe++;
        if (probe === 1) return true;
        if (probe === 2) return false;
        throw new Error('indeterminate');
      },
      publish: (_tarball, pkg) => log.push(`publish:${pkg.name}`),
    })).toThrow('indeterminate');
    expect(log.slice(20)).toEqual([
      `probe:${PACKED_PACKAGE_NAMES[0]}`,
      `probe:${PACKED_PACKAGE_NAMES[1]}`,
      `publish:${PACKED_PACKAGE_NAMES[1]}`,
      `probe:${PACKED_PACKAGE_NAMES[2]}`,
    ]);
  }));
});
