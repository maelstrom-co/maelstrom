import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  type ArchiveProcessRequest,
  MAX_PACKED_TARBALL_BYTES,
  PACKED_PACKAGE_NAMES,
  parsePackedManifest,
  validatePackedManifest,
} from './packed-manifest.ts';
import { listPublishablePackages } from './workspace-packages.ts';

type TarMember = {
  name: string;
  body?: string;
  type?: '0' | '1' | '2' | '3' | '4' | '5' | '6';
  linkName?: string;
};

function writeOctal(
  buffer: Buffer,
  offset: number,
  length: number,
  value: number,
) {
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
  for (const entry of entries)
    writeFileSync(join(dir, entry.tarball), 'fixture');
}

function fakeArchiveProcess(request: ArchiveProcessRequest) {
  const name =
    PACKED_PACKAGE_NAMES[Number(request.archive.match(/(\d+)\.tgz$/)?.[1])];
  return request.argv[0] === '-tvzf'
    ? {
        status: 0,
        stdout: Buffer.from(
          '-rw-r--r-- 0 0 0 42 Jan 1 00:00 package/package.json\n',
        ),
        stderr: Buffer.alloc(0),
      }
    : {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ name, version: '1.2.3' })),
        stderr: Buffer.alloc(0),
      };
}

describe('release package coverage', () => {
  test('accepts the complete publishable workspace so newly packed packages cannot strand a release', () => {
    const root = resolve(import.meta.dirname, '../..');
    const packages = listPublishablePackages(root);
    const entries = packages.map((pkg, index) => ({
      name: pkg.name,
      version: '1.2.3',
      tarball: `release-${index}.tgz`,
    }));

    expect(parsePackedManifest(entries, '1.2.3')).toEqual(entries);
    expect(packages.map((pkg) => pkg.name).sort()).toEqual(
      [...PACKED_PACKAGE_NAMES].sort(),
    );
    expect(entries.map((pkg) => pkg.name)).toContain(
      '@maelstrom-co/realtime-openai-live',
    );
    expect(entries.map((pkg) => pkg.name)).toContain(
      '@maelstrom-co/realtime-openai-live-server',
    );
  });
});

describe('validatePackedManifest policy', () => {
  test.each([
    ['non-array manifest', {}],
    ['malformed entry', [{ name: '@maelstrom-co/client' }]],
    [
      'entry with extra keys',
      manifest().map((entry, index) =>
        index === 0 ? { ...entry, extra: true } : entry,
      ),
    ],
    [
      'unknown package',
      manifest().map((entry, index) =>
        index === 0 ? { ...entry, name: '@maelstrom-co/unknown' } : entry,
      ),
    ],
    ['missing package', manifest().slice(1)],
    [
      'duplicate package',
      manifest().map((entry, index, all) =>
        index === 1 ? { ...entry, name: all[0]!.name } : entry,
      ),
    ],
    [
      'duplicate tarball',
      manifest().map((entry, index, all) =>
        index === 1 ? { ...entry, tarball: all[0]!.tarball } : entry,
      ),
    ],
    [
      'wrong version',
      manifest().map((entry, index) =>
        index === 9 ? { ...entry, version: '1.2.4' } : entry,
      ),
    ],
  ])('rejects %s before archive inspection', (_name, input) => {
    let calls = 0;
    expect(() =>
      validatePackedManifest(input, '1.2.3', '/unused', {
        runArchiveProcess: () => {
          calls++;
          return fakeArchiveProcess({
            archive: '',
            argv: [],
            cwd: '',
            env: { LC_ALL: 'C' },
            timeoutMs: 0,
            maxOutputBytes: 0,
          });
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });

  test.each([
    '',
    '.',
    '..',
    '-x.tgz',
    'x.tar',
    '/x.tgz',
    '../x.tgz',
    'a/x.tgz',
    'a\\x.tgz',
  ])('rejects unsafe tarball path %p', (tarball) => {
    const entries = manifest();
    entries[0] = { ...entries[0]!, tarball };
    expect(() => validatePackedManifest(entries, '1.2.3', '/unused')).toThrow();
  });

  test.each([
    'missing',
    'symlink',
    'directory',
  ])('rejects a %s tarball', (kind) =>
    withTempDir((dir) => {
      const entries = manifest();
      writeManifestFiles(dir, entries);
      const target = join(dir, entries[0]!.tarball);
      rmSync(target);
      if (kind === 'symlink') {
        writeFileSync(join(dir, 'target.tgz'), 'fixture');
        symlinkSync('target.tgz', target);
      } else if (kind === 'directory') {
        mkdirSync(target);
      }

      expect(() =>
        validatePackedManifest(entries, '1.2.3', dir, {
          runArchiveProcess: fakeArchiveProcess,
        }),
      ).toThrow('regular file');
    }));

  test('rejects an oversized tarball before archive inspection', () =>
    withTempDir((dir) => {
      const entries = manifest();
      writeManifestFiles(dir, entries);
      writeFileSync(
        join(dir, entries[0]!.tarball),
        Buffer.alloc(MAX_PACKED_TARBALL_BYTES + 1),
      );
      let calls = 0;
      expect(() =>
        validatePackedManifest(entries, '1.2.3', dir, {
          runArchiveProcess: (request) => {
            calls++;
            return fakeArchiveProcess(request);
          },
        }),
      ).toThrow('size limit');
      expect(calls).toBe(0);
    }));
});

describe('validatePackedManifest archive process contract', () => {
  test('validates every configured real archive using exact tar argv', () =>
    withTempDir((dir) => {
      const entries = manifest();
      for (const entry of entries) {
        writeFileSync(
          join(dir, entry.tarball),
          tarGzip([
            {
              name: 'package/package.json',
              body: JSON.stringify({
                name: entry.name,
                version: entry.version,
              }),
            },
          ]),
        );
      }
      expect(validatePackedManifest(entries, '1.2.3', dir)).toHaveLength(
        PACKED_PACKAGE_NAMES.length,
      );
    }));

  test.each([
    [
      'duplicate',
      [
        { name: 'package/package.json', body: '{}' },
        { name: 'package/package.json', body: '{}' },
      ],
    ],
    ['alias', [{ name: './package/package.json', body: '{}' }]],
    [
      'hardlink',
      [
        {
          name: 'package/package.json',
          type: '1' as const,
          linkName: 'elsewhere',
        },
      ],
    ],
    [
      'symlink',
      [
        {
          name: 'package/package.json',
          type: '2' as const,
          linkName: 'elsewhere',
        },
      ],
    ],
    [
      'character device',
      [{ name: 'package/package.json', type: '3' as const }],
    ],
    ['block device', [{ name: 'package/package.json', type: '4' as const }]],
    ['directory', [{ name: 'package/package.json', type: '5' as const }]],
    ['FIFO', [{ name: 'package/package.json', type: '6' as const }]],
  ])('rejects a real archive with a %s metadata member', (_name, members) =>
    withTempDir((dir) => {
      const entries = manifest();
      writeManifestFiles(dir, entries);
      writeFileSync(join(dir, entries[0]!.tarball), tarGzip(members));
      expect(() => validatePackedManifest(entries, '1.2.3', dir)).toThrow();
    }));

  test.each([
    [
      'malformed listing',
      { status: 0, stdout: Buffer.from('nonsense\n'), stderr: Buffer.alloc(0) },
    ],
    [
      'stderr warning',
      {
        status: 0,
        stdout: Buffer.from('- file\n'),
        stderr: Buffer.from('warning'),
      },
    ],
    [
      'non-zero exit',
      { status: 2, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    ],
    [
      'timeout',
      {
        status: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        error: new Error('timed out'),
      },
    ],
    [
      'output overflow',
      {
        status: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        error: Object.assign(new Error('overflow'), { code: 'ENOBUFS' }),
      },
    ],
  ])('fails closed on %s', (_name, result) =>
    withTempDir((dir) => {
      const entries = manifest();
      writeManifestFiles(dir, entries);
      expect(() =>
        validatePackedManifest(entries, '1.2.3', dir, {
          runArchiveProcess: () => result,
        }),
      ).toThrow();
    }));

  test('rejects invalid embedded metadata and mismatches', () =>
    withTempDir((dir) => {
      const entries = manifest();
      writeManifestFiles(dir, entries);
      for (const body of [
        'not json',
        '{}',
        JSON.stringify({ name: entries[0]!.name, version: '9.9.9' }),
      ]) {
        const runArchiveProcess = (request: ArchiveProcessRequest) =>
          request.argv[0] === '-tvzf'
            ? fakeArchiveProcess(request)
            : { status: 0, stdout: Buffer.from(body), stderr: Buffer.alloc(0) };
        expect(() =>
          validatePackedManifest(entries, '1.2.3', dir, { runArchiveProcess }),
        ).toThrow();
      }
    }));

  test('uses bounded no-shell archive requests', () =>
    withTempDir((dir) => {
      const entries = manifest();
      writeManifestFiles(dir, entries);
      const requests: ArchiveProcessRequest[] = [];
      validatePackedManifest(entries, '1.2.3', dir, {
        runArchiveProcess: (request) => {
          requests.push(request);
          return fakeArchiveProcess(request);
        },
      });

      expect(requests).toHaveLength(PACKED_PACKAGE_NAMES.length * 2);
      for (let index = 0; index < entries.length; index++) {
        const canonicalDir = realpathSync(dir);
        const archive = join(canonicalDir, entries[index]!.tarball);
        expect(requests[index * 2]).toMatchObject({
          archive,
          argv: ['-tvzf', archive, 'package/package.json'],
          cwd: canonicalDir,
          env: { LC_ALL: 'C' },
        });
        expect(requests[index * 2]!.timeoutMs).toBeGreaterThan(0);
        expect(requests[index * 2]!.maxOutputBytes).toBeGreaterThan(0);
        expect(requests[index * 2 + 1]).toMatchObject({
          archive,
          argv: ['-xOzf', archive, 'package/package.json'],
          cwd: canonicalDir,
          env: { LC_ALL: 'C' },
        });
      }
    }));
});
