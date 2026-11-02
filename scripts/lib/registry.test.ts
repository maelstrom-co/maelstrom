import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authenticationFailureHint,
  hasPublishedIntegrity,
  parsePublishedVersion,
  shouldTreatNotFoundAsUnpublished,
} from './registry.ts';

describe('hasPublishedIntegrity', () => {
  const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
  test.each([
    {
      name: 'ordinary integrity',
      output: JSON.stringify({ version: '1.2.3', 'dist.integrity': integrity }),
      status: 0,
      expected: true,
    },
    {
      name: 'npm 12 singleton integrity',
      output: JSON.stringify([
        { version: '1.2.3', 'dist.integrity': integrity },
      ]),
      status: 0,
      expected: true,
    },
    {
      name: 'not visible',
      output: '',
      error: 'npm error code E404',
      status: 1,
      expected: false,
    },
    {
      name: 'empty successful lookup is unknown',
      output: '',
      status: 0,
      message: 'no version or integrity',
    },
    {
      name: 'visible version without integrity',
      output: JSON.stringify({ version: '1.2.3' }),
      status: 0,
      message: 'missing or invalid integrity',
    },
    {
      name: 'another version is not proof of this release',
      output: JSON.stringify({ version: '9.9.9', 'dist.integrity': integrity }),
      status: 0,
      message: 'another version',
    },
    {
      name: 'different bytes',
      output: JSON.stringify({
        version: '1.2.3',
        'dist.integrity': `sha512-${Buffer.alloc(64, 2).toString('base64')}`,
      }),
      status: 0,
      message: 'published bytes differ',
    },
    {
      name: 'unauthorized',
      output: '',
      error: 'npm error code E401',
      status: 1,
      message: 'authentication failed',
    },
    {
      name: 'authorization cannot be hidden by an incidental E404',
      output: '',
      error: 'npm error code E401\nupstream mentioned E404',
      status: 1,
      message: 'authentication failed',
    },
    {
      name: 'invalid metadata',
      output: '{broken json',
      status: 0,
      message: '',
    },
  ])('$name', ({ output, error = '', status, expected, message }) => {
    const directory = mkdtempSync(join(tmpdir(), 'maelstrom-integrity-'));
    const npm = join(directory, 'npm');
    writeFileSync(
      npm,
      '#!/bin/sh\nprintf "%s" "$FIELD_OUTPUT"\nprintf "%s" "$FIELD_ERROR" >&2\nexit "$FIELD_STATUS"\n',
    );
    chmodSync(npm, 0o755);
    const previousPath = process.env.PATH;
    const previous = [
      process.env.FIELD_OUTPUT,
      process.env.FIELD_ERROR,
      process.env.FIELD_STATUS,
    ];
    try {
      process.env.PATH = `${directory}:${previousPath}`;
      process.env.FIELD_OUTPUT = output;
      process.env.FIELD_ERROR = error;
      process.env.FIELD_STATUS = String(status);
      const check = () =>
        hasPublishedIntegrity(
          '@maelstrom-co/react',
          '1.2.3',
          'https://registry.npmjs.org',
          integrity,
        );
      if (message !== undefined) expect(check).toThrow(message);
      else expect(check()).toBe(expected);
    } finally {
      process.env.PATH = previousPath;
      for (const [index, name] of [
        'FIELD_OUTPUT',
        'FIELD_ERROR',
        'FIELD_STATUS',
      ].entries()) {
        const value = previous[index];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('isAlreadyPublished', () => {
  test('bounds a slow registry lookup so verification can honor its deadline', () => {
    const directory = mkdtempSync(join(tmpdir(), 'maelstrom-slow-npm-'));
    const npm = join(directory, 'npm');
    writeFileSync(npm, `#!${process.execPath}\nawait Bun.sleep(10_000);\n`);
    chmodSync(npm, 0o755);
    try {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `import { isAlreadyPublished } from './scripts/lib/registry.ts';
          try {
            isAlreadyPublished('@maelstrom-co/react', '0.2.0', 'https://registry.npmjs.org', 50);
            process.exit(1);
          } catch (error) {
            if (!String(error).includes('could not determine')) process.exit(1);
          }`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
          timeout: 5_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  const cases: Array<{
    name: string;
    registry: string;
    stdout?: string;
    stderr?: string;
    exit?: string;
    expected?: boolean;
    throws?: true;
  }> = [
    {
      name: 'recognizes an ordinary published version',
      registry: 'https://registry.npmjs.org',
      stdout: '"0.2.0-alpha.1"',
      expected: true,
    },
    {
      name: 'recognizes npm 12 singleton output so recovery skips immutable versions',
      registry: 'https://registry.npmjs.org',
      stdout: '["0.2.0-alpha.1"]',
      expected: true,
    },
    {
      name: 'treats GitHub Packages empty success as unpublished',
      registry: 'https://npm.pkg.github.com',
      stdout: '',
      expected: false,
    },
    {
      name: 'treats an explicit missing GitHub package as unpublished',
      registry: 'https://npm.pkg.github.com',
      stderr:
        'npm error code E404\nnpm error 404 Not Found - GET https://npm.pkg.github.com/@maelstrom-co%2frealtime-openai-server - npm package "realtime-openai-server" does not exist under owner "maelstrom-co"',
      exit: '1',
      expected: false,
    },
    {
      name: 'keeps generic GitHub Packages E404 indeterminate',
      registry: 'https://npm.pkg.github.com',
      stderr: 'npm error code E404\nnpm error 404 Not Found',
      exit: '1',
      throws: true,
    },
    {
      name: 'treats npmjs E404 as unpublished',
      registry: 'https://registry.npmjs.org',
      stderr: 'npm error code E404\nnpm error 404 Not Found',
      exit: '1',
      expected: false,
    },
  ];

  test.each(cases)('$name', ({ registry, stdout, stderr, exit, ...result }) => {
    const binDir = mkdtempSync(join(tmpdir(), 'maelstrom-fake-npm-'));
    const npm = join(binDir, 'npm');
    writeFileSync(
      npm,
      '#!/bin/sh\nprintf \'%s\' "$FAKE_NPM_STDOUT"\nprintf \'%s\' "$FAKE_NPM_STDERR" >&2\nexit "$FAKE_NPM_EXIT"\n',
    );
    chmodSync(npm, 0o755);

    try {
      const subprocess = spawnSync(
        process.execPath,
        [
          '-e',
          `import { isAlreadyPublished } from './scripts/lib/registry.ts'; console.log('RESULT:' + isAlreadyPublished('@maelstrom-co/react', '0.2.0-alpha.1', process.env.TEST_REGISTRY!));`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            FAKE_NPM_STDOUT: stdout ?? '',
            FAKE_NPM_STDERR: stderr ?? '',
            FAKE_NPM_EXIT: exit ?? '0',
            TEST_REGISTRY: registry,
          },
        },
      );

      if ('throws' in result) {
        expect(subprocess.status).not.toBe(0);
        expect(`${subprocess.stdout}${subprocess.stderr}`).toContain(
          'could not determine',
        );
      } else {
        expect(subprocess.status).toBe(0);
        expect(subprocess.stdout).toContain(`RESULT:${result.expected}`);
      }
    } finally {
      rmSync(binDir, { force: true, recursive: true });
    }
  });
});

describe('shouldTreatNotFoundAsUnpublished', () => {
  const notFound = 'npm error code E404\nnpm error 404 Not Found';

  test('rejects ambiguous 404 responses from private GitHub Packages', () => {
    expect(
      shouldTreatNotFoundAsUnpublished(notFound, 'https://npm.pkg.github.com'),
    ).toBe(false);
  });

  test('accepts GitHub Packages response that names a missing exact version', () => {
    expect(
      shouldTreatNotFoundAsUnpublished(
        `${notFound}\nnpm error 404 No match found for version 0.1.0-alpha.0`,
        'https://npm.pkg.github.com',
      ),
    ).toBe(true);
  });

  test('accepts GitHub Packages response that explicitly names a missing package', () => {
    expect(
      shouldTreatNotFoundAsUnpublished(
        `${notFound}\nnpm error 404 Not Found - GET https://npm.pkg.github.com/@maelstrom-co%2frealtime-openai-server - npm package "realtime-openai-server" does not exist under owner "maelstrom-co"`,
        'https://npm.pkg.github.com',
      ),
    ).toBe(true);
  });

  test('accepts npmjs 404 responses as an absent package version', () => {
    expect(
      shouldTreatNotFoundAsUnpublished(notFound, 'https://registry.npmjs.org'),
    ).toBe(true);
  });
});

describe('authenticationFailureHint', () => {
  test('explains GitHub Packages repository access', () => {
    expect(authenticationFailureHint('https://npm.pkg.github.com')).toContain(
      'linked to this repository',
    );
  });

  test('explains npmjs authentication without GitHub repository advice', () => {
    const hint = authenticationFailureHint('https://registry.npmjs.org');

    expect(hint).toContain('npmjs.org');
    expect(hint).not.toContain('linked to this repository');
  });
});

describe('parsePublishedVersion', () => {
  const registry = 'https://npm.pkg.github.com';

  test('recognizes the immutable version returned by the registry', () => {
    expect(
      parsePublishedVersion(
        '"0.2.0-alpha.1"\n',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        registry,
      ),
    ).toBe(true);
  });

  test('treats GitHub Packages empty success response as unpublished', () => {
    expect(
      parsePublishedVersion(
        '',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        registry,
      ),
    ).toBe(false);
  });

  test('accepts a singleton field array from npm 12', () => {
    expect(
      parsePublishedVersion(
        '["0.2.0-alpha.1"]\n',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        'https://registry.npmjs.org',
      ),
    ).toBe(true);
  });

  test.each([
    { label: 'empty arrays', output: '[]' },
    { label: 'a different singleton version', output: '["0.2.0-alpha.0"]' },
    { label: 'repeated versions', output: '["0.2.0-alpha.1","0.2.0-alpha.1"]' },
    {
      label: 'conflicting versions',
      output: '["0.2.0-alpha.1","0.2.0-alpha.0"]',
    },
    { label: 'nested arrays', output: '[["0.2.0-alpha.1"]]' },
  ])('rejects $label rather than guessing publication state', ({ output }) => {
    expect(() =>
      parsePublishedVersion(
        output,
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        'https://registry.npmjs.org',
      ),
    ).toThrow('Refusing to guess');
  });

  test('rejects an unexpected version instead of skipping a required publish', () => {
    expect(() =>
      parsePublishedVersion(
        '"0.2.0-alpha.0"',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        registry,
      ),
    ).toThrow('Refusing to guess');
  });
});

describe('hasPublishedPackage', () => {
  test.each([
    {
      label: 'matching public package',
      stdout: '"@maelstrom-co/react"',
      stderr: '',
      exit: '0',
      expected: true,
    },
    {
      label:
        'matching npm 12 singleton output permits an existing-package preview',
      stdout: '["@maelstrom-co/react"]',
      stderr: '',
      exit: '0',
      expected: true,
    },
    {
      label: 'empty identity array',
      stdout: '[]',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'wrong singleton identity',
      stdout: '["@other/package"]',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'multiple identity results',
      stdout: '["@maelstrom-co/react","@maelstrom-co/react"]',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'nested identity array',
      stdout: '[["@maelstrom-co/react"]]',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'absent package',
      stdout: '',
      stderr: 'npm error code E404',
      exit: '1',
      expected: false,
    },
    {
      label: 'wrong identity',
      stdout: '"@other/package"',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'malformed response',
      stdout: 'not json',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'empty response',
      stdout: '',
      stderr: '',
      exit: '0',
      expected: undefined,
    },
    {
      label: 'unavailable registry',
      stdout: '',
      stderr: 'private credential detail E503',
      exit: '1',
      expected: undefined,
    },
  ])('$label', (entry) => {
    const binDir = mkdtempSync(join(tmpdir(), 'maelstrom-existence-'));
    writeFileSync(
      join(binDir, 'npm'),
      '#!/bin/sh\n[ "$NPM_CONFIG_USERCONFIG" = /dev/null ] || exit 99\n[ "$1" = view ] && [ "$2" = @maelstrom-co/react ] && [ "$3" = name ] || exit 98\nprintf \'%s\' "$FAKE_NPM_STDOUT"\nprintf \'%s\' "$FAKE_NPM_STDERR" >&2\nexit "$FAKE_NPM_EXIT"\n',
    );
    chmodSync(join(binDir, 'npm'), 0o755);
    try {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          "import { hasPublishedPackage } from './scripts/lib/registry.ts'; console.log('RESULT:' + hasPublishedPackage('@maelstrom-co/react', 'https://registry.npmjs.org'));",
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            NPM_CONFIG_USERCONFIG: '/should-not-be-used',
            FAKE_NPM_STDOUT: entry.stdout,
            FAKE_NPM_STDERR: entry.stderr,
            FAKE_NPM_EXIT: entry.exit,
          },
        },
      );
      if (entry.expected === undefined) {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          'could not verify public package existence',
        );
      } else {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`RESULT:${entry.expected}`);
      }
      expect(result.stdout + result.stderr).not.toContain(
        'private credential detail',
      );
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
