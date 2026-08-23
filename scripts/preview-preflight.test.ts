import { afterAll, describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePreviewConfiguration } from './preview-preflight.ts';
import { isWorkersDevSuffix } from './preview-worker-url.ts';

const settings = {
  PRODUCTION_ACCOUNT_ID: 'production-account',
  PREVIEW_ACCOUNT_ID: 'preview-account',
  CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX: 'preview.workers.dev',
  CLOUDFLARE_PREVIEW_ACCOUNT_ID: 'preview-account',
  CLOUDFLARE_PREVIEW_API_TOKEN: 'test-token-never-log',
};

describe('preview configuration preflight', () => {
  test.each([
    [
      'PRODUCTION_ACCOUNT_ID',
      'Settings → Secrets and variables → Actions → Variables',
    ],
    [
      'PREVIEW_ACCOUNT_ID',
      'Settings → Secrets and variables → Actions → Variables',
    ],
    [
      'CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX',
      'Settings → Environments → preview → Environment variables',
    ],
    [
      'CLOUDFLARE_PREVIEW_ACCOUNT_ID',
      'Settings → Environments → preview → Environment secrets',
    ],
    [
      'CLOUDFLARE_PREVIEW_API_TOKEN',
      'Settings → Environments → preview → Environment secrets',
    ],
  ])('names the setting and repair location when %s is missing', (key, location) => {
    for (const value of [undefined, '', ' \t\n']) {
      const errors = validatePreviewConfiguration({
        ...settings,
        [key]: value,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`'${key}'`);
      expect(errors[0]).toContain(location);
      expect(errors.join('\n')).not.toContain(
        settings.CLOUDFLARE_PREVIEW_API_TOKEN,
      );
    }
  });

  test('reports every missing setting in one run so maintainers can repair configuration together', () => {
    const errors = validatePreviewConfiguration({});
    expect(errors).toHaveLength(5);
    for (const name of Object.keys(settings)) {
      expect(errors.some((error) => error.includes(`'${name}'`))).toBe(true);
    }
  });

  test.each([
    'preview.workers.dev\ninvalid',
    'invalid\npreview.workers.dev',
    'preview.workers.dev\n',
    'preview.workers.dev\r\n',
    'preview.workers.dev\u2028',
    'https://preview.workers.dev',
    '-preview.workers.dev',
    'preview-.workers.dev',
    `${'a'.repeat(64)}.workers.dev`,
  ])('rejects malformed suffix %j before deployment', (suffix) => {
    expect(isWorkersDevSuffix(suffix)).toBe(false);
    const errors = validatePreviewConfiguration({
      ...settings,
      CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX: suffix,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("'CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX'");
    expect(errors[0]).toContain(
      'Settings → Environments → preview → Environment variables',
    );
    expect(errors.join('\n')).not.toContain(suffix);
  });

  test.each([
    'a.workers.dev',
    'preview-account.workers.dev',
    `${'a'.repeat(63)}.workers.dev`,
  ])('allows valid suffix %s without diagnostics', (suffix) => {
    expect(isWorkersDevSuffix(suffix)).toBe(true);
    expect(
      validatePreviewConfiguration({
        ...settings,
        CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX: suffix,
      }),
    ).toEqual([]);
  });

  test('rejects equal account variables so swapped secrets cannot pass both deployment guards', () => {
    const errors = validatePreviewConfiguration({
      ...settings,
      PREVIEW_ACCOUNT_ID: settings.PRODUCTION_ACCOUNT_ID,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "'PRODUCTION_ACCOUNT_ID' and 'PREVIEW_ACCOUNT_ID' must be different",
    );
    expect(errors[0]).not.toContain(settings.PRODUCTION_ACCOUNT_ID);
  });
});

describe('preflight command', () => {
  const root = mkdtempSync(join(tmpdir(), 'preview-preflight-'));
  mkdirSync(join(root, 'scripts'));
  for (const name of [
    'preview-preflight.ts',
    'preview-worker-url.ts',
    'preview-lifecycle.bunfig.toml',
  ]) {
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts', name));
  }
  writeFileSync(
    join(root, '.env'),
    Object.entries(settings)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  );
  writeFileSync(
    join(root, 'bunfig.toml'),
    'preload = ["./unexpected-preload.ts"]\n',
  );
  writeFileSync(
    join(root, 'unexpected-preload.ts'),
    'throw new Error("ambient preload ran");',
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function run(environment: Record<string, string>) {
    return Bun.spawnSync(
      [
        process.execPath,
        '--config=scripts/preview-lifecycle.bunfig.toml',
        '--no-env-file',
        '--no-install',
        'scripts/preview-preflight.ts',
      ],
      { cwd: root, env: environment },
    );
  }

  test('fails with annotations instead of accepting ambient .env or Bun configuration', () => {
    const result = run({});
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('');
    const errors = result.stderr.toString().trim().split('\n');
    expect(errors).toHaveLength(5);
    expect(
      errors.every((error) =>
        error.startsWith('::error::Required Actions setting'),
      ),
    ).toBe(true);
  });

  test('succeeds without installed dependencies or credential output', () => {
    const result = run(settings);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toBe('');
  });
});
