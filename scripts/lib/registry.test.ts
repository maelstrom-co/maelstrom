import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authenticationFailureHint,
  parsePublishedVersion,
  shouldTreatNotFoundAsUnpublished,
} from './registry.ts';

describe('isAlreadyPublished', () => {
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
      name: 'treats GitHub Packages empty success as unpublished',
      registry: 'https://npm.pkg.github.com',
      stdout: '',
      expected: false,
    },
    {
      name: 'keeps GitHub Packages E404 indeterminate',
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
