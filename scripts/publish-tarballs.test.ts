import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  type ArchiveProcessRequest,
  PACKED_MANIFEST_FILENAME,
  PACKED_PACKAGE_NAMES,
} from './lib/packed-manifest.ts';
import { parsePublishArgs, publishTarballs } from './publish-tarballs.ts';

function withArtifact(run: (dir: string, log: string[]) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'maelstrom-publisher-'));
  const log: string[] = [];
  const packages = PACKED_PACKAGE_NAMES.map((name, index) => ({
    name,
    version: '1.2.3',
    tarball: `package-${index}.tgz`,
  }));
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
      ? {
          status: 0,
          stdout: Buffer.from(
            '-rw-r--r-- 0 0 0 42 Jan 1 00:00 package/package.json\n',
          ),
          stderr: Buffer.alloc(0),
        }
      : {
          status: 0,
          stdout: Buffer.from(JSON.stringify({ name: pkg, version: '1.2.3' })),
          stderr: Buffer.alloc(0),
        };
  };
}

function writeOctal(
  buffer: Buffer,
  offset: number,
  length: number,
  value: number,
) {
  buffer.write(
    value.toString(8).padStart(length - 1, '0'),
    offset,
    length - 1,
    'ascii',
  );
  buffer[offset + length - 1] = 0;
}

function packageTarball(name: string, version: string) {
  const body = Buffer.from(JSON.stringify({ name, version }));
  const header = Buffer.alloc(512);
  header.write('package/package.json', 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, body.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return gzipSync(
    Buffer.concat([
      header,
      body,
      Buffer.alloc((512 - (body.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}

describe('parsePublishArgs', () => {
  test('requires exactly one canonical expected version', () => {
    expect(
      parsePublishArgs(
        ['--tag', 'latest', '--expected-version', '1.2.3'],
        '/repo',
      ).expectedVersion,
    ).toBe('1.2.3');
    for (const args of [
      ['--tag', 'latest'],
      ['--tag', 'latest', '--expected-version'],
      ['--tag', 'latest', '--expected-version', '--dry-run'],
      ['--tag', 'latest', '--expected-version', '01.2.3'],
      [
        '--tag',
        'latest',
        '--expected-version',
        '1.2.3',
        '--expected-version',
        '1.2.3',
      ],
      ['--tag', 'latest', '--expected-version=1.2.3'],
      ['--tag', 'latest', '--expected-version', ''],
    ])
      expect(() => parsePublishArgs(args, '/repo')).toThrow('expected-version');
  });
});

describe('publishTarballs', () => {
  test('validates the complete collection before the first registry probe', () =>
    withArtifact((dir, log) => {
      publishTarballs(
        {
          dir,
          tag: 'latest',
          registry: 'https://example.test',
          expectedVersion: '1.2.3',
          dryRun: false,
          provenance: false,
          skipPublished: true,
        },
        {
          runArchiveProcess: archiveProcess(log),
          isAlreadyPublished: (name) => {
            log.push(`probe:${name}`);
            return true;
          },
          publish: (_tarball, pkg) => log.push(`publish:${pkg.name}`),
        },
      );
      expect(log.filter((event) => event.startsWith('read:'))).toHaveLength(10);
      expect(log.findIndex((event) => event.startsWith('probe:'))).toBe(20);
      expect(log.some((event) => event.startsWith('publish:'))).toBe(false);
    }));

  test('does not probe or publish when the tenth archive is invalid', () =>
    withArtifact((dir, log) => {
      const runArchiveProcess = archiveProcess(log);
      expect(() =>
        publishTarballs(
          {
            dir,
            tag: 'latest',
            registry: 'https://example.test',
            expectedVersion: '1.2.3',
            dryRun: false,
            provenance: false,
            skipPublished: true,
          },
          {
            runArchiveProcess: (request) =>
              request.archive.endsWith('9.tgz') && request.argv[0] === '-xOzf'
                ? {
                    status: 0,
                    stdout: Buffer.from('{}'),
                    stderr: Buffer.alloc(0),
                  }
                : runArchiveProcess(request),
            isAlreadyPublished: (name) => {
              log.push(`probe:${name}`);
              return false;
            },
            publish: (_tarball, pkg) => log.push(`publish:${pkg.name}`),
          },
        ),
      ).toThrow();
      expect(
        log.some(
          (event) => event.startsWith('probe:') || event.startsWith('publish:'),
        ),
      ).toBe(false);
    }));

  test('revalidates changed artifact bytes before skipping a rerun', () =>
    withArtifact((dir, log) => {
      const options = {
        dir,
        tag: 'latest',
        registry: 'https://example.test',
        expectedVersion: '1.2.3',
        dryRun: false,
        provenance: false,
        skipPublished: true,
      };
      const dependencies = {
        runArchiveProcess: archiveProcess(log),
        isAlreadyPublished: (name: string) => {
          log.push(`probe:${name}`);
          return true;
        },
        publish: (_tarball: string, pkg: { name: string }) =>
          log.push(`publish:${pkg.name}`),
      };
      publishTarballs(options, dependencies);
      writeFileSync(join(dir, 'package-0.tgz'), 'changed bytes');
      log.push('rerun');
      publishTarballs(options, dependencies);
      const rerun = log.indexOf('rerun');
      expect(
        log.slice(rerun + 1).findIndex((event) => event.startsWith('probe:')),
      ).toBe(20);
    }));

  test('publishes the same canonical paths and bytes that were validated', () =>
    withArtifact((dir) => {
      const before = new Map(
        PACKED_PACKAGE_NAMES.map((name, index) => {
          const path = join(realpathSync(dir), `package-${index}.tgz`);
          writeFileSync(path, packageTarball(name, '1.2.3'));
          return [
            path,
            createHash('sha256').update(readFileSync(path)).digest('hex'),
          ];
        }),
      );
      const publishedPaths: string[] = [];

      publishTarballs(
        {
          dir,
          tag: 'latest',
          registry: 'https://example.test',
          expectedVersion: '1.2.3',
          dryRun: false,
          provenance: false,
          skipPublished: false,
        },
        {
          isAlreadyPublished: () => false,
          publish: (tarball) => publishedPaths.push(tarball),
        },
      );

      expect(publishedPaths).toEqual([...before.keys()]);
      for (const path of publishedPaths) {
        const expectedHash = before.get(path);
        if (expectedHash === undefined) {
          throw new Error(`Missing expected hash for published path: ${path}`);
        }
        expect(
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        ).toBe(expectedHash);
      }
    }));

  test('preserves partial reruns and stops on an indeterminate probe', () =>
    withArtifact((dir, log) => {
      let probe = 0;
      expect(() =>
        publishTarballs(
          {
            dir,
            tag: 'latest',
            registry: 'https://example.test',
            expectedVersion: '1.2.3',
            dryRun: false,
            provenance: false,
            skipPublished: true,
          },
          {
            runArchiveProcess: archiveProcess(log),
            isAlreadyPublished: (name) => {
              log.push(`probe:${name}`);
              probe++;
              if (probe === 1) return true;
              if (probe === 2) return false;
              throw new Error('indeterminate');
            },
            publish: (_tarball, pkg) => log.push(`publish:${pkg.name}`),
          },
        ),
      ).toThrow('indeterminate');
      expect(log.slice(20)).toEqual([
        `probe:${PACKED_PACKAGE_NAMES[0]}`,
        `probe:${PACKED_PACKAGE_NAMES[1]}`,
        `publish:${PACKED_PACKAGE_NAMES[1]}`,
        `probe:${PACKED_PACKAGE_NAMES[2]}`,
      ]);
    }));
});

function step(text: string, name: string) {
  const marker = `      - name: ${name}\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name} step`);
  const next = text.indexOf('\n      - name: ', start + marker.length);
  return text.slice(start, next < 0 ? text.length : next);
}

function expectTrustedVersion(stepText: string, version: RegExp) {
  expect(stepText).toMatch(version);
  expect(stepText).toMatch(/--expected-version\s+"\$VERSION"/);
}

describe('workflow expected-version authority', () => {
  test('keeps trusted VERSION in each privileged publish step', async () => {
    const preview = await Bun.file('.github/workflows/publish-pr.yml').text();
    const release = await Bun.file('.github/workflows/release.yml').text();
    expectTrustedVersion(
      step(preview, 'Publish packages'),
      /VERSION:\s*0\.0\.0-pr\.\$\{\{\s*github\.event\.pull_request\.number\s*\}\}\.\$\{\{\s*github\.run_number\s*\}\}\.\$\{\{\s*github\.run_attempt\s*\}\}/,
    );
    expectTrustedVersion(
      step(release, 'Publish'),
      /VERSION:\s*\$\{\{\s*needs\.prepare\.outputs\.version\s*\}\}/,
    );
  });

  test.each([
    [
      'missing',
      '      - name: Publish packages\n        run: bun publish --expected-version "$VERSION"\n',
    ],
    [
      'another step',
      '      - name: Other\n        env:\n          VERSION: 1.2.3\n      - name: Publish packages\n        run: bun publish --expected-version "$VERSION"\n',
    ],
    [
      'another variable',
      '      - name: Publish packages\n        env:\n          VERSION: 1.2.3\n        run: bun publish --expected-version "$OTHER"\n',
    ],
  ])('rejects VERSION authority that is %s', (_name, fixture) => {
    expect(() =>
      expectTrustedVersion(
        step(fixture, 'Publish packages'),
        /VERSION:\s*1\.2\.3/,
      ),
    ).toThrow();
  });
});
