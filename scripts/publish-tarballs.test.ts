import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
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
  for (const pkg of packages) {
    writeFileSync(
      join(dir, pkg.tarball),
      packageTarball(pkg.name, pkg.version),
    );
  }
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
    log.push(`${request.argv[0] === '-xOzf' ? 'read' : 'list'}:${pkg}`);
    if (request.argv[0] === '-tzf') {
      return {
        status: 0,
        stdout: Buffer.from('package/package.json\n'),
        stderr: Buffer.alloc(0),
      };
    }
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

function tarMember(
  path: string,
  metadata: unknown,
  options: {
    prefix?: string;
    version?: string;
    type?: string;
    rawBody?: string;
  } = {},
) {
  const body = Buffer.from(options.rawBody ?? JSON.stringify(metadata));
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, body.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(options.type ?? '0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write(options.version ?? '00', 263, 2, 'ascii');
  if (options.prefix) header.write(options.prefix, 345, 155, 'utf8');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return [header, body, Buffer.alloc((512 - (body.length % 512)) % 512)];
}

function packageTarball(name: string, version: string) {
  return gzipSync(
    Buffer.concat([
      ...tarMember('package/package.json', { name, version }),
      Buffer.alloc(1024),
    ]),
  );
}

function paxRecord(key: string, value: string) {
  const tail = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(tail) + 1;
  while (length !== String(length).length + Buffer.byteLength(tail)) {
    length = String(length).length + Buffer.byteLength(tail);
  }
  return `${length}${tail}`;
}

describe('parsePublishArgs', () => {
  test('preview guard is explicit while release bootstrap remains possible', () => {
    const args = ['--tag', 'pr-318', '--expected-version', '0.0.0-pr.318.1.1'];
    expect(parsePublishArgs(args).requireExisting).toBe(false);
    expect(
      parsePublishArgs([...args, '--require-existing']).requireExisting,
    ).toBe(true);
  });
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
  test('a preview checks the complete collection before its first publication', () =>
    withArtifact((dir) => {
      const checked: string[] = [];
      const published: string[] = [];
      const result = publishTarballs(
        {
          dir,
          tag: 'pr-318',
          registry: 'https://registry.npmjs.org',
          expectedVersion: '1.2.3',
          dryRun: false,
          provenance: false,
          skipPublished: false,
          requireExisting: true,
        },
        {
          hasPublishedPackage: (name) => {
            checked.push(name);
            return true;
          },
          publish: (_tarball, pkg) => {
            expect(checked).toHaveLength(PACKED_PACKAGE_NAMES.length);
            published.push(pkg.name);
          },
        },
      );
      expect(result.succeeded).toBe(PACKED_PACKAGE_NAMES.length);
      expect(published).toEqual(checked);
    }));
  test('preview dry runs validate archives without registry access', () =>
    withArtifact((dir) => {
      const result = publishTarballs(
        {
          dir,
          tag: 'pr-318',
          registry: 'https://registry.npmjs.org',
          expectedVersion: '1.2.3',
          dryRun: true,
          provenance: false,
          skipPublished: false,
          requireExisting: true,
        },
        {
          hasPublishedPackage: () => {
            throw new Error('unexpected registry access');
          },
          publish: () => {},
        },
      );
      expect(result.succeeded).toBe(PACKED_PACKAGE_NAMES.length);
    }));

  test.each([
    'missing',
    'unavailable',
  ])('a preview publishes nothing when a later package is %s', (failure) => {
    withArtifact((dir) => {
      const published: string[] = [];
      expect(() =>
        publishTarballs(
          {
            dir,
            tag: 'pr-318',
            registry: 'https://registry.npmjs.org',
            expectedVersion: '1.2.3',
            dryRun: false,
            provenance: false,
            skipPublished: false,
            requireExisting: true,
          },
          {
            hasPublishedPackage: (name) => {
              if (name === PACKED_PACKAGE_NAMES[9]) {
                if (failure === 'unavailable')
                  throw new Error('registry unavailable');
                return false;
              }
              return true;
            },
            publish: (_tarball, pkg) => {
              published.push(pkg.name);
            },
          },
        ),
      ).toThrow(
        failure === 'missing' ? 'first release' : 'registry unavailable',
      );
      expect(published).toEqual([]);
    });
  });

  test.each([
    'alternate root',
    'USTAR version',
    'PAX comment',
  ])('rejects %s metadata collisions before any registry probe or publish', (variant) =>
    withArtifact((dir, log) => {
      const unsafeMetadata = {
        name: PACKED_PACKAGE_NAMES[9],
        version: '9.9.9',
        publishConfig: { proxy: 'http://127.0.0.1:9', 'strict-ssl': false },
      };
      let extraMembers: Buffer[];
      if (variant === 'USTAR version') {
        extraMembers = tarMember('other/package.json', unsafeMetadata, {
          prefix: 'package/dist',
          version: '01',
        });
      } else if (variant === 'PAX comment') {
        extraMembers = [
          ...tarMember('package/PaxHeader', undefined, {
            type: 'x',
            rawBody: paxRecord(
              'comment',
              `hello\n${paxRecord('path', 'other/package.json')}`,
            ),
          }),
          ...tarMember('package/dist/data.json', unsafeMetadata),
        ];
      } else {
        extraMembers = tarMember('other/package.json', unsafeMetadata);
      }
      writeFileSync(
        join(dir, 'package-9.tgz'),
        gzipSync(
          Buffer.concat([
            ...tarMember('package/package.json', {
              name: PACKED_PACKAGE_NAMES[9],
              version: '1.2.3',
            }),
            ...extraMembers,
            Buffer.alloc(1024),
          ]),
        ),
      );

      expect(() =>
        publishTarballs(
          {
            dir,
            tag: 'alpha',
            registry: 'https://registry.npmjs.org',
            expectedVersion: '1.2.3',
            dryRun: false,
            provenance: false,
            skipPublished: true,
            requireExisting: true,
          },
          {
            hasPublishedPackage: () => {
              log.push('probe');
              return true;
            },
            isAlreadyPublished: () => {
              log.push('probe');
              return false;
            },
            publish: () => {
              log.push('publish');
            },
          },
        ),
      ).toThrow('Archive');
      expect(log).toEqual([]);
    }));

  test('the actual npm command requests public access and disables lifecycle hooks beside publishing identity', () =>
    withArtifact((dir) => {
      const bin = join(dir, 'bin');
      const commandLog = join(dir, 'npm-commands.jsonl');
      mkdirSync(bin);
      writeFileSync(
        join(bin, 'npm'),
        `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.NPM_COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
        { mode: 0o755 },
      );
      const result = spawnSync(
        process.execPath,
        [
          resolve(import.meta.dirname, 'publish-tarballs.ts'),
          '--dir',
          dir,
          '--expected-version',
          '1.2.3',
          '--tag',
          'alpha',
          '--registry',
          'https://registry.npmjs.org',
          '--dry-run',
          '--provenance',
        ],
        {
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH}`,
            NPM_COMMAND_LOG: commandLog,
          },
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const commands = readFileSync(commandLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(commands).toEqual(
        PACKED_PACKAGE_NAMES.map((_name, index) => [
          'publish',
          join(realpathSync(dir), `package-${index}.tgz`),
          '--tag',
          'alpha',
          '--registry',
          'https://registry.npmjs.org',
          '--access',
          'public',
          '--ignore-scripts',
          '--dry-run',
          '--provenance',
        ]),
      );
    }));

  test.each([
    { registry: 'https://example.invalid', access: 'public' },
    { registry: 'https://registry.npmjs.org', access: 'restricted' },
    {
      registry: 'https://registry.npmjs.org',
      access: 'public',
      '@maelstrom-co:registry': 'https://example.invalid',
    },
    {
      registry: 'https://registry.npmjs.org',
      access: 'public',
      proxy: 'https://example.invalid:8443',
    },
    {
      registry: 'https://registry.npmjs.org',
      access: 'public',
      'strict-ssl': false,
    },
  ])('rejects artifact configuration that can redirect or weaken authenticated npm requests: %j', (publishConfig) =>
    withArtifact((dir, log) => {
      const inspect = archiveProcess(log);
      expect(() =>
        publishTarballs(
          {
            dir,
            tag: 'alpha',
            registry: 'https://registry.npmjs.org',
            expectedVersion: '1.2.3',
            dryRun: false,
            provenance: false,
            skipPublished: true,
          },
          {
            runArchiveProcess: (request) => {
              const result = inspect(request);
              if (request.argv[0] === '-xOzf') {
                result.stdout = Buffer.from(
                  JSON.stringify({
                    ...JSON.parse(result.stdout.toString()),
                    publishConfig,
                  }),
                );
              }
              return result;
            },
            isAlreadyPublished: () => {
              log.push('probe');
              return false;
            },
            publish: () => {
              log.push('publish');
            },
          },
        ),
      ).toThrow('Unsafe embedded publishConfig');
      expect(log).not.toContain('probe');
      expect(log).not.toContain('publish');
    }));

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
      expect(log.filter((event) => event.startsWith('read:'))).toHaveLength(
        PACKED_PACKAGE_NAMES.length,
      );
      expect(log.findIndex((event) => event.startsWith('probe:'))).toBe(
        PACKED_PACKAGE_NAMES.length * 3,
      );
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
      expect(() => publishTarballs(options, dependencies)).toThrow('Archive');
      const rerun = log.indexOf('rerun');
      expect(log.slice(rerun + 1)).toEqual([]);
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
      expect(log.slice(PACKED_PACKAGE_NAMES.length * 3)).toEqual([
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
  test('uses reviewed main publisher code when manually recovering a tag', async () => {
    const release = await Bun.file('.github/workflows/release.yml').text();
    const publishJob = release.slice(release.indexOf('\n  publish:'));
    expect(release).toMatch(
      /publisher_commit:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && github\.sha \|\| steps\.commit\.outputs\.commit\s*\}\}/,
    );
    const publisherGuard = step(
      release,
      'Assert tagged dispatch uses main publisher',
    );
    expect(publisherGuard).toMatch(
      /if:\s*github\.event_name == 'workflow_dispatch' && inputs\.tag != ''/,
    );
    expect(publisherGuard).toMatch(
      /WORKFLOW_REF:\s*\$\{\{\s*github\.ref\s*\}\}/,
    );
    expect(publisherGuard).toMatch(
      /if \[\[ "\$WORKFLOW_REF" != 'refs\/heads\/main' \]\]; then[\s\S]*exit 1/,
    );
    expect(step(publishJob, 'Checkout')).toMatch(
      /ref:\s*\$\{\{\s*needs\.prepare\.outputs\.publisher_commit\s*\}\}/,
    );
    expect(step(publishJob, 'Verify packages are live')).toMatch(
      /--manifest "\$TARBALL_DIR\/packed\.json"/,
    );
  });

  test('finishes an unversioned branch rehearsal after build and pack', async () => {
    const release = await Bun.file('.github/workflows/release.yml').text();
    expect(release).toMatch(
      /publish:\n(?:.*\n){0,8}\s+if:\s*needs\.prepare\.outputs\.version\s*!=\s*''/,
    );
  });

  test('keeps trusted VERSION in each privileged publish step', async () => {
    const preview = await Bun.file('.github/workflows/publish-pr.yml').text();
    expect(step(preview, 'Publish packages')).toContain('--require-existing');
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
