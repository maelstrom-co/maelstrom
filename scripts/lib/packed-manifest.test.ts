import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import {
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_PACKED_TARBALL_BYTES,
  PACKED_PACKAGE_NAMES,
  type ArchiveProcessRequest,
  validatePackedManifest,
} from './packed-manifest.ts';

type TarMember = {
  name: string;
  body?: string;
  type?: '0' | '1' | '2' | '3';
  linkName?: string;
};

function writeOctal(buffer: Buffer, offset: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, '0');
  buffer.write(text, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function tarGzip(members: TarMember[]): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const body = Buffer.from(member.body ?? '');
    const header = Buffer.alloc(512);
    header.write(member.name, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write(member.type ?? '0', 156, 1, 'ascii');
    if (member.linkName) header.write(member.linkName, 157, 100, 'utf8');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function manifest(version = '1.2.3') {
  return PACKED_PACKAGE_NAMES.map((name, index) => ({
    name,
    version,
    tarball: `package-${index}.tgz`,
  }));
}

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'maelstrom-packed-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function writeManifestFiles(dir: string, entries = manifest()) {
  for (const entry of entries) writeFileSync(join(dir, entry.tarball), 'fixture');
}

function fakeArchiveProcess(request: ArchiveProcessRequest) {
  const name = PACKED_PACKAGE_NAMES[Number(request.archive.match(/(\d+)\.tgz$/)?.[1])];
  return request.argv[0] === '-tvzf'
    ? { status: 0, stdout: Buffer.from('-rw-r--r-- 0 0 0 42 Jan 1 00:00 package/package.json\n'), stderr: Buffer.alloc(0) }
    : { status: 0, stdout: Buffer.from(JSON.stringify({ name, version: '1.2.3' })), stderr: Buffer.alloc(0) };
}

describe('validatePackedManifest policy', () => {
  test.each([
    ['non-array manifest', {}],
    ['malformed entry', [{ name: '@maelstrom-co/client' }]],
    ['entry with extra keys', manifest().map((entry, index) => (index === 0 ? { ...entry, extra: true } : entry))],
    ['unknown package', manifest().map((entry, index) => (index === 0 ? { ...entry, name: '@maelstrom-co/unknown' } : entry))],
    ['missing package', manifest().slice(1)],
    ['duplicate package', manifest().map((entry, index, all) => (index === 1 ? { ...entry, name: all[0]!.name } : entry))],
    ['wrong version', manifest().map((entry, index) => (index === 9 ? { ...entry, version: '1.2.4' } : entry))],
  ])('rejects %s before archive inspection', (_name, input) => {
    let calls = 0;
    expect(() => validatePackedManifest(input, '1.2.3', '/unused', { runArchiveProcess: () => { calls++; return fakeArchiveProcess({ archive: '', argv: [], cwd: '', env: {}, timeoutMs: 0, maxOutputBytes: 0 }); } })).toThrow();
    expect(calls).toBe(0);
  });

  test.each(['', '.', '..', '-x.tgz', 'x.tar', '/x.tgz', '../x.tgz', 'a/x.tgz', 'a\\x.tgz'])('rejects unsafe tarball path %p', (tarball) => {
    const entries = manifest();
    entries[0] = { ...entries[0]!, tarball };
    expect(() => validatePackedManifest(entries, '1.2.3', '/unused')).toThrow();
  });

  test('rejects missing, symlinked, non-regular, and oversized tarballs', () => withTempDir((dir) => {
    const entries = manifest();
    writeManifestFiles(dir, entries);

    rmSync(join(dir, entries[0]!.tarball));
    expect(() => validatePackedManifest(entries, '1.2.3', dir, { runArchiveProcess: fakeArchiveProcess })).toThrow('regular file');

    writeFileSync(join(dir, 'target.tgz'), 'fixture');
    symlinkSync('target.tgz', join(dir, entries[0]!.tarball));
    expect(() => validatePackedManifest(entries, '1.2.3', dir, { runArchiveProcess: fakeArchiveProcess })).toThrow('regular file');

    rmSync(join(dir, entries[0]!.tarball));
    rmSync(join(dir, entries[1]!.tarball));
    Bun.write(join(dir, entries[1]!.tarball), new Blob([]));
    const stat = lstatSync(join(dir, entries[1]!.tarball));
    expect(stat.isFile()).toBe(true);
    writeFileSync(join(dir, entries[0]!.tarball), Buffer.alloc(1));
    const oversized = { ...entries[0]!, tarball: 'oversized.tgz' };
    writeFileSync(join(dir, oversized.tarball), Buffer.alloc(1));
    Object.defineProperty(lstatSync(join(dir, oversized.tarball)), 'size', { value: MAX_PACKED_TARBALL_BYTES + 1 });
  }));
});

describe('validatePackedManifest archive process contract', () => {
  test('validates all ten real archives using exact tar argv', () => withTempDir((dir) => {
    const entries = manifest();
    for (const entry of entries) {
      writeFileSync(join(dir, entry.tarball), tarGzip([{ name: 'package/package.json', body: JSON.stringify({ name: entry.name, version: entry.version }) }]));
    }
    expect(validatePackedManifest(entries, '1.2.3', dir)).toHaveLength(10);
  }));

  test.each([
    ['duplicate', [{ name: 'package/package.json', body: '{}' }, { name: 'package/package.json', body: '{}' }]],
    ['alias', [{ name: './package/package.json', body: '{}' }]],
    ['symlink', [{ name: 'package/package.json', type: '2' as const, linkName: 'elsewhere' }]],
    ['hardlink', [{ name: 'package/package.json', type: '1' as const, linkName: 'elsewhere' }]],
  ])('rejects a real archive with a %s metadata member', (_name, members) => withTempDir((dir) => {
    const entries = manifest();
    writeManifestFiles(dir, entries);
    writeFileSync(join(dir, entries[0]!.tarball), tarGzip(members));
    expect(() => validatePackedManifest(entries, '1.2.3', dir)).toThrow();
  }));

  test.each([
    ['malformed listing', { status: 0, stdout: Buffer.from('nonsense\n'), stderr: Buffer.alloc(0) }],
    ['stderr warning', { status: 0, stdout: Buffer.from('- file\n'), stderr: Buffer.from('warning') }],
    ['timeout', { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: new Error('timed out') }],
    ['output overflow', { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: Object.assign(new Error('overflow'), { code: 'ENOBUFS' }) }],
  ])('fails closed on %s', (_name, result) => withTempDir((dir) => {
    const entries = manifest();
    writeManifestFiles(dir, entries);
    expect(() => validatePackedManifest(entries, '1.2.3', dir, { runArchiveProcess: () => result })).toThrow();
  }));

  test('rejects invalid embedded metadata and mismatches', () => withTempDir((dir) => {
    const entries = manifest();
    writeManifestFiles(dir, entries);
    for (const body of ['not json', '{}', JSON.stringify({ name: entries[0]!.name, version: '9.9.9' })]) {
      const runArchiveProcess = (request: ArchiveProcessRequest) => request.argv[0] === '-tvzf'
        ? fakeArchiveProcess(request)
        : { status: 0, stdout: Buffer.from(body), stderr: Buffer.alloc(0) };
      expect(() => validatePackedManifest(entries, '1.2.3', dir, { runArchiveProcess })).toThrow();
    }
  }));
});
