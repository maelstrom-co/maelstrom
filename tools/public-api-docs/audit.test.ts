import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  auditArtifactFiles,
  auditPackedPackage,
  installPackedConsumer,
  type PackageAuditInput,
} from './audit';
import { compareStripInternal } from './strip-internal-comparison';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'public-api-docs-test-'));
  temporaryRoots.push(root);
  return root;
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function copyAuditCli(workspace: string): Promise<void> {
  const [auditSource, discoverySource, workspacePackagesSource] =
    await Promise.all([
      readFile(join(import.meta.dir, 'audit.ts'), 'utf8'),
      readFile(join(import.meta.dir, 'package-discovery.ts'), 'utf8'),
      readFile(
        join(import.meta.dir, '../../scripts/lib/workspace-packages.ts'),
        'utf8',
      ),
    ]);
  await Promise.all([
    write(join(workspace, 'tools/public-api-docs/audit.ts'), auditSource),
    write(
      join(workspace, 'tools/public-api-docs/package-discovery.ts'),
      discoverySource,
    ),
    write(
      join(workspace, 'scripts/lib/workspace-packages.ts'),
      workspacePackagesSource,
    ),
  ]);
}

async function emitDeclaration(
  source: string,
): Promise<{ declaration: string; root: string }> {
  const root = await temporaryRoot();
  await write(join(root, 'src/index.ts'), source);
  await write(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        outDir: 'dist',
        strict: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  const result = Bun.spawnSync([
    join(import.meta.dir, '../../node_modules/.bin/tsc'),
    '-p',
    join(root, 'tsconfig.json'),
  ]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return { declaration: join(root, 'dist/index.d.ts'), root };
}

async function createTarball(
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): Promise<string> {
  return createTarballWithManifest(
    name,
    JSON.stringify({ name, version: '1.0.0', ...manifest }),
    files,
  );
}

async function createTarballWithManifest(
  name: string,
  manifest: string,
  files: Record<string, string>,
): Promise<string> {
  const root = await temporaryRoot();
  const packageRoot = join(root, 'package');
  await write(join(packageRoot, 'package.json'), manifest);
  for (const [path, contents] of Object.entries(files)) {
    await write(join(packageRoot, path), contents);
  }
  const tarball = join(root, `${name.replaceAll('/', '-')}.tgz`);
  const result = Bun.spawnSync(['tar', '-czf', tarball, '-C', root, 'package']);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return tarball;
}

function runTool(path: string, arguments_: string[]) {
  return Bun.spawnSync(
    [process.execPath, join(import.meta.dir, path), ...arguments_],
    {
      cwd: join(import.meta.dir, '../..'),
      stderr: 'pipe',
      stdout: 'pipe',
    },
  );
}

/**
 * Runs the TypeDoc audit from an isolated repository-shaped workspace. Source
 * Markdown is always present so the generated-HTML prerequisite is exercised
 * independently of supplemental documentation content.
 */
async function runTypedocAudit(generated: 'missing' | 'empty' | 'valid') {
  const workspace = await temporaryRoot();
  await copyAuditCli(workspace);
  await symlink(
    join(import.meta.dir, '../../node_modules'),
    join(workspace, 'node_modules'),
  );
  await write(
    join(workspace, 'apps/docs/src/content/docs/reference/index.md'),
    '# Supplemental source reference\n',
  );
  const generatedRoot = join(workspace, 'apps/docs/dist/reference');
  if (generated === 'empty') {
    await write(join(generatedRoot, 'ignored.txt'), 'not generated HTML');
  } else if (generated === 'valid') {
    await write(join(generatedRoot, 'index.html'), '<h1>Generated API</h1>');
  }
  return Bun.spawnSync(
    [
      process.execPath,
      join(workspace, 'tools/public-api-docs/audit.ts'),
      '--typedoc',
    ],
    { cwd: workspace, stderr: 'pipe', stdout: 'pipe' },
  );
}

async function createDeclarationAuditWorkspace(): Promise<string> {
  const workspace = await temporaryRoot();
  await copyAuditCli(workspace);
  await write(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  );
  await symlink(
    join(import.meta.dir, '../../node_modules'),
    join(workspace, 'node_modules'),
  );
  return workspace;
}

function runDeclarationAudit(workspace: string, arguments_: string[] = []) {
  return Bun.spawnSync(
    [
      process.execPath,
      join(workspace, 'tools/public-api-docs/audit.ts'),
      '--declarations',
      ...arguments_,
    ],
    { cwd: workspace, stderr: 'pipe', stdout: 'pipe' },
  );
}

async function writePublishableFixture(workspace: string): Promise<void> {
  await write(
    join(workspace, 'packages/publishable/package.json'),
    JSON.stringify({
      name: '@fixture/publishable',
      version: '1.0.0',
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      },
      files: ['dist'],
    }),
  );
  await write(
    join(workspace, 'packages/publishable/dist/index.d.ts'),
    'export declare const publishable: true;',
  );
  await write(
    join(workspace, 'packages/publishable/dist/index.js'),
    'export const publishable = true;',
  );
}

describe('generated TypeDoc prerequisite', () => {
  test('reports missing generated HTML as a JSON audit error', async () => {
    const result = await runTypedocAudit('missing');

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe('');
    expect(JSON.parse(result.stdout.toString()).errors).toEqual([
      {
        path: 'apps/docs/dist/reference',
        rule: 'missing-typedoc-html',
        message:
          'Generated TypeDoc output contains no HTML; build the documentation site before running the TypeDoc audit.',
      },
    ]);
  });

  test('reports an HTML-free generated directory as a JSON audit error', async () => {
    const result = await runTypedocAudit('empty');

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe('');
    expect(JSON.parse(result.stdout.toString()).errors).toEqual([
      {
        path: 'apps/docs/dist/reference',
        rule: 'missing-typedoc-html',
        message:
          'Generated TypeDoc output contains no HTML; build the documentation site before running the TypeDoc audit.',
      },
    ]);
  });

  test('scans valid generated HTML with supplemental source Markdown', async () => {
    const result = await runTypedocAudit('valid');
    const report = JSON.parse(result.stdout.toString());

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(report.errors).toEqual([]);
    expect(
      report.scanned.map((path: string) => path.replaceAll('\\', '/')),
    ).toEqual([
      expect.stringContaining('/apps/docs/dist/reference/index.html'),
      expect.stringContaining('/apps/docs/src/content/docs/reference/index.md'),
    ]);
  });
});

describe('forbidden public documentation prose', () => {
  test('finds a ticket leak after TypeScript declaration emit', async () => {
    const { declaration } = await emitDeclaration(
      '/** Implemented for MAE-123. */\nexport class Engine {}',
    );

    const report = await auditArtifactFiles([declaration]);

    expect(
      report.findings.some(({ rule }) => rule === 'numeric-ticket-id'),
    ).toBe(true);
  });

  test('finds a packed non-root declaration that is absent from the barrel', async () => {
    const tarball = await createTarball(
      '@fixture/non-root',
      {
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      {
        'dist/index.d.ts': 'export declare const publicValue = 1;',
        'dist/index.js': 'export const publicValue = 1;',
        'dist/private-helper.d.ts':
          '/** FIXME before release. */\nexport declare const helper = 1;',
      },
    );

    const report = await auditPackedPackage(tarball);

    expect(report.findings).toMatchObject([
      { path: 'package/dist/private-helper.d.ts', rule: 'roadmap-marker' },
    ]);
  });

  test('finds a TODO in both emitted declarations and generated TypeDoc', async () => {
    const { declaration, root } = await emitDeclaration(
      '/** TODO(multi-instance): serialize this later. */\nexport class Engine {}',
    );
    const docs = join(root, 'docs');
    const typedocTsconfig = join(root, 'typedoc-tsconfig.json');
    await write(
      typedocTsconfig,
      JSON.stringify({
        compilerOptions: { strict: true },
        files: [declaration],
      }),
    );
    const typedoc = Bun.spawnSync([
      process.execPath,
      'run',
      '--cwd',
      join(import.meta.dir, '../../apps/docs'),
      'typedoc',
      '--entryPoints',
      declaration,
      '--tsconfig',
      typedocTsconfig,
      '--out',
      docs,
    ]);
    expect(typedoc.exitCode, typedoc.stderr.toString()).toBe(0);
    const pages = (await readdir(docs, { recursive: true }))
      .filter((path) => path.endsWith('.html'))
      .map((path) => join(docs, path));

    const report = await auditArtifactFiles([declaration, ...pages]);

    expect(
      report.findings.filter(({ rule }) => rule === 'roadmap-marker'),
    ).toHaveLength(2);
  }, 30_000);

  test('allows a stable consumer-facing concurrency limitation', async () => {
    const { declaration } = await emitDeclaration(
      '/** Concurrent requests in one process are serialized until the active request settles. */\nexport class Engine {}',
    );

    expect((await auditArtifactFiles([declaration])).findings).toEqual([]);
  });

  test('allows internal as a public contrast rather than banning the word', async () => {
    const { declaration } = await emitDeclaration(
      '/** Public wire DTO; unlike the internal storage shape, this omits database metadata. */\nexport interface WireDto { id: string }',
    );

    expect((await auditArtifactFiles([declaration])).findings).toEqual([]);
  });

  test.each([
    'RFC-9110',
    'ISO-8601',
    'ECMA-262',
  ])('allows the public standard reference %s', async (reference) => {
    const { declaration } = await emitDeclaration(
      `/** Follows ${reference}. */\nexport class Engine {}`,
    );

    expect((await auditArtifactFiles([declaration])).findings).toEqual([]);
  });
});

describe('packed package qualification', () => {
  test('uses an owned portable workspace and removes it after the CLI exits', async () => {
    const root = await temporaryRoot();
    const bin = join(root, 'bin');
    const temporaryDirectory = join(root, 'tmp');
    const tarLog = join(root, 'tar.log');
    const workspace = join(root, 'workspace');
    const packageRoot = join(workspace, 'packages/portable');
    await mkdir(bin);
    await mkdir(temporaryDirectory);
    await write(
      join(workspace, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    );
    await write(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@fixture/portable',
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
        files: ['dist'],
        publishConfig: { access: 'public' },
      }),
    );
    await write(
      join(packageRoot, 'dist/index.d.ts'),
      'export declare const portable: true;',
    );
    await write(
      join(packageRoot, 'dist/index.js'),
      'export const portable = true;',
    );
    await copyAuditCli(workspace);
    await symlink(
      join(import.meta.dir, '../../node_modules'),
      join(workspace, 'node_modules'),
    );
    const tarWrapper = join(bin, 'tar');
    await write(
      tarWrapper,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TAR_LOG"\nexec "$REAL_TAR" "$@"\n',
    );
    await chmod(tarWrapper, 0o755);
    const realTar = Bun.which('tar');
    expect(realTar).not.toBeNull();

    const result = Bun.spawnSync(
      [
        process.execPath,
        join(workspace, 'tools/public-api-docs/audit.ts'),
        '--declarations',
        '--packages=@fixture/portable',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          REAL_TAR: realTar ?? '',
          TAR_LOG: tarLog,
          TMPDIR: temporaryDirectory,
        },
        stderr: 'pipe',
        stdout: 'pipe',
      },
    );

    const tarLogContents = await readFile(tarLog, 'utf8').catch(
      () => '<tar log was not created>',
    );
    expect(
      result.exitCode,
      JSON.stringify(
        {
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
          tarLog: tarLogContents,
        },
        null,
        2,
      ),
    ).toBe(0);
    expect(tarLogContents).toContain(temporaryDirectory);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  }, 30_000);

  test('reports missing shipped export targets in deterministic order', async () => {
    const tarball = await createTarball(
      '@fixture/missing',
      {
        exports: {
          '.': {
            types: './dist/missing.d.ts',
            import: './dist/missing.js',
            default: './dist/default.js',
          },
        },
      },
      {},
    );

    const report = await auditPackedPackage(tarball);

    expect(report.errors.map(({ target }) => target)).toEqual([
      './dist/default.js',
      './dist/missing.d.ts',
      './dist/missing.js',
    ]);
  });

  test('rejects non-relative concrete export targets in deterministic order', async () => {
    const tarball = await createTarball(
      '@fixture/non-relative-exports',
      {
        type: 'module',
        exports: {
          '.': {
            types: '/dist/index.d.ts',
            import: 'dist/index.js',
            browser: 'other-package',
            default: './dist/index.js',
          },
        },
      },
      {
        'dist/index.d.ts': 'export declare const value: number;',
        'dist/index.js': 'export const value = 1;',
      },
    );

    const report = await auditPackedPackage(tarball);
    const consumer = await installPackedConsumer(
      [{ name: '@fixture/non-relative-exports', tarball }],
      await temporaryRoot(),
    );

    expect(report.errors.map(({ rule, target }) => ({ rule, target }))).toEqual(
      [
        { rule: 'invalid-export-target', target: '/dist/index.d.ts' },
        { rule: 'invalid-export-target', target: 'dist/index.js' },
        { rule: 'invalid-export-target', target: 'other-package' },
      ],
    );
    expect(consumer.errors).toEqual([
      '@fixture/non-relative-exports has invalid export target /dist/index.d.ts; targets must begin with ./.',
      '@fixture/non-relative-exports has invalid export target dist/index.js; targets must begin with ./.',
      '@fixture/non-relative-exports has invalid export target other-package; targets must begin with ./.',
    ]);
  }, 30_000);

  test('ignores an absent development source condition but rejects absent shipped conditions', async () => {
    const tarball = await createTarball(
      '@fixture/source-condition',
      {
        exports: {
          '.': {
            '@maelstrom-co/source': './src/index.ts',
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      },
      { 'dist/index.d.ts': 'export {};', 'dist/index.js': 'export {};' },
    );

    expect((await auditPackedPackage(tarball)).errors).toEqual([]);
  });

  test.each([
    ['root subpath', { '.': 42 }],
    ['subpath', { './feature': false }],
    ['condition', { '.': { import: true } }],
    [
      'nested fallback array member',
      { '.': ['./dist/index.js', { import: ['./dist/fallback.js', 42] }] },
    ],
  ])('returns an invalid-tarball error for a malformed %s export', async (_label, exports) => {
    const tarball = await createTarball(
      '@fixture/malformed-export',
      { exports },
      {
        'dist/index.d.ts': 'export declare const clean = true;',
        'dist/index.js': 'export const clean = true;',
        'dist/fallback.js': 'export const fallback = true;',
      },
    );

    const report = await auditPackedPackage(tarball);

    expect(report.errors.map(({ rule }) => rule)).toEqual(['invalid-tarball']);
    expect(report.findings).toEqual([]);
    expect(report.scanned).toEqual([]);
  });

  test('accepts null blockers and recursively valid fallback arrays', async () => {
    const tarball = await createTarball(
      '@fixture/export-fallbacks',
      {
        exports: {
          '.': {
            types: './dist/index.d.ts',
            browser: null,
            import: [[], null, { bun: './dist/index.js' }, './dist/index.js'],
          },
        },
      },
      {
        'dist/index.d.ts': 'export declare const valid = true;',
        'dist/index.js': 'export const valid = true;',
      },
    );

    expect((await auditPackedPackage(tarball)).errors).toEqual([]);
  });

  test('scans every packed declaration extension even when unreachable from exports', async () => {
    const tarball = await createTarball(
      '@fixture/deep',
      {
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      {
        'dist/index.d.ts': 'export {};',
        'dist/index.js': 'export {};',
        'dist/a.d.ts': '/** HACK: temporary. */\nexport {};',
        'dist/b.d.mts': '/** See company-internal tracker. */\nexport {};',
        'dist/c.d.cts': '/** Grep `legacyName` before changing. */\nexport {};',
      },
    );

    const report = await auditPackedPackage(tarball);

    expect(report.findings.map(({ rule }) => rule)).toEqual([
      'roadmap-marker',
      'company-internal-reference',
      'grep-instruction',
    ]);
  });

  test('loads packed root and subpath runtime entrypoints including an empty module', async () => {
    const tarball = await createTarball(
      '@fixture/runtime',
      {
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
          './reserved': {
            types: './dist/reserved.d.ts',
            import: './dist/reserved.js',
          },
          './package.json': './package.json',
        },
      },
      {
        'dist/index.d.ts': 'export declare const value: number;',
        'dist/index.js': 'export const value = 1;',
        'dist/reserved.d.ts': 'export {};',
        'dist/reserved.js': 'export {};',
      },
    );
    const input: PackageAuditInput = { name: '@fixture/runtime', tarball };
    const consumerRoot = await temporaryRoot();
    const staleMarker = join(consumerRoot, 'stale-workspace-marker');
    await write(staleMarker, 'must be removed');

    const result = await installPackedConsumer([input], consumerRoot);

    expect(result.errors).toEqual([]);
    expect(await Bun.file(staleMarker).exists()).toBe(false);
    expect(
      JSON.parse(await readFile(join(consumerRoot, 'tsconfig.json'), 'utf8'))
        .compilerOptions.skipLibCheck,
    ).toBe(false);
  }, 30_000);

  test('checks a root string export in the packed consumer', async () => {
    const tarball = await createTarball(
      '@fixture/root-string',
      { type: 'module', exports: './dist/index.js' },
      {
        'dist/index.d.ts': 'export {};',
        'dist/index.js': "throw new Error('root-string-entrypoint-loaded');",
      },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/root-string', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('root-string-entrypoint-loaded');
  }, 30_000);

  test('checks an adjacent declaration for a root string export', async () => {
    const tarball = await createTarball(
      '@fixture/root-string-types',
      { type: 'module', exports: './dist/index.js' },
      {
        'dist/index.d.ts':
          'export declare const brokenValue: MissingRootStringType;',
        'dist/index.js': 'export const brokenValue = 1;',
      },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/root-string-types', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('MissingRootStringType');
  }, 30_000);

  test('checks an adjacent declaration for a string subpath export', async () => {
    const tarball = await createTarball(
      '@fixture/string-subpath-types',
      { type: 'module', exports: { './feature': './dist/feature.js' } },
      {
        'dist/feature.d.ts':
          'export declare const brokenValue: MissingStringSubpathType;',
        'dist/feature.js': 'export const brokenValue = 1;',
      },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/string-subpath-types', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('MissingStringSubpathType');
  }, 30_000);

  test('checks an adjacent declaration for an import-only root condition', async () => {
    const tarball = await createTarball(
      '@fixture/import-only-root-types',
      {
        type: 'module',
        exports: { import: './dist/index.js' },
      },
      {
        'dist/index.d.ts':
          'export declare const brokenValue: MissingImportOnlyRootType;',
        'dist/index.js': 'export const brokenValue = 1;',
      },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/import-only-root-types', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('MissingImportOnlyRootType');
  }, 30_000);

  test('checks root direct conditions in the packed consumer', async () => {
    const tarball = await createTarball(
      '@fixture/root-conditions',
      {
        type: 'module',
        exports: { types: './dist/index.d.ts', import: './dist/index.js' },
      },
      {
        'dist/index.d.ts':
          'export declare const brokenValue: MissingRootConditionType;',
        'dist/index.js': 'export const brokenValue = 1;',
      },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/root-conditions', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('MissingRootConditionType');
  }, 30_000);

  test('rejects wildcard export targets with a deterministic error', async () => {
    const tarball = await createTarball(
      '@fixture/wildcard',
      {
        type: 'module',
        exports: {
          './features/*': {
            types: './dist/features/*.d.ts',
            import: './dist/features/*.js',
          },
        },
      },
      {
        'dist/features/example.d.ts': 'export {};',
        'dist/features/example.js': 'export {};',
      },
    );

    const report = await auditPackedPackage(tarball);
    const consumer = await installPackedConsumer(
      [{ name: '@fixture/wildcard', tarball }],
      await temporaryRoot(),
    );

    expect(report.errors.map(({ rule, target }) => ({ rule, target }))).toEqual(
      [
        {
          rule: 'unsupported-wildcard-export-target',
          target: './dist/features/*.d.ts',
        },
        {
          rule: 'unsupported-wildcard-export-target',
          target: './dist/features/*.js',
        },
      ],
    );
    expect(consumer.errors).toEqual([
      '@fixture/wildcard has unsupported wildcard export target ./dist/features/*.d.ts.',
      '@fixture/wildcard has unsupported wildcard export target ./dist/features/*.js.',
    ]);
  }, 30_000);

  test('installs interdependent local tarballs in one transaction', async () => {
    const dependency = await createTarball(
      '@fixture/dependency',
      {
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      {
        'dist/index.d.ts': 'export declare const value: number;',
        'dist/index.js': 'export const value = 1;',
      },
    );
    const consumer = await createTarball(
      '@fixture/consumer',
      {
        type: 'module',
        dependencies: { '@fixture/dependency': '1.0.0' },
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      {
        'dist/index.d.ts': "export { value } from '@fixture/dependency';",
        'dist/index.js': "export { value } from '@fixture/dependency';",
      },
    );

    const result = await installPackedConsumer(
      [
        { name: '@fixture/dependency', tarball: dependency },
        { name: '@fixture/consumer', tarball: consumer },
      ],
      await temporaryRoot(),
    );

    expect(result.errors).toEqual([]);
  }, 30_000);

  test('rejects a broken declaration shipped by the packed package', async () => {
    const tarball = await createTarball(
      '@fixture/broken-declaration',
      {
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      {
        'dist/index.d.ts':
          'export declare const brokenValue: MissingDeclarationType;',
        'dist/index.js': 'export const brokenValue = 1;',
      },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/broken-declaration', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('consumer typecheck failed');
    expect(result.errors[0]).toContain('MissingDeclarationType');
  }, 30_000);

  test('rejects unresolved local dependency protocols in the packed manifest', async () => {
    const protocols = [
      'catalog:',
      'workspace:*',
      'link:../dependency',
      'file:../dependency',
    ];
    const tarball = await createTarball(
      '@fixture/protocols',
      {
        dependencies: Object.fromEntries(
          protocols.map((protocol, index) => [`dependency-${index}`, protocol]),
        ),
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      { 'dist/index.d.ts': 'export {};', 'dist/index.js': 'export {};' },
    );

    const report = await auditPackedPackage(tarball);

    expect(report.errors.map(({ rule }) => rule)).toEqual([
      'consumer-invalid-dependency',
      'consumer-invalid-dependency',
      'consumer-invalid-dependency',
      'consumer-invalid-dependency',
    ]);
  });

  test('rejects consumer-invalid dependency and peer dependency protocols only', async () => {
    const tarball = await createTarball(
      '@fixture/protocol-fields',
      {
        dependencies: { 'z-dependency': 'workspace:*' },
        peerDependencies: { 'a-peer': 'file:../peer' },
        optionalDependencies: { 'ignored-optional': 'link:../optional' },
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      { 'dist/index.d.ts': 'export {};', 'dist/index.js': 'export {};' },
    );

    const report = await auditPackedPackage(tarball);

    expect(
      report.errors.map(({ rule, message }) => ({ rule, message })),
    ).toEqual([
      {
        rule: 'consumer-invalid-dependency',
        message:
          'dependencies.z-dependency uses consumer-invalid dependency specifier workspace:*.',
      },
      {
        rule: 'consumer-invalid-dependency',
        message:
          'peerDependencies.a-peer uses consumer-invalid dependency specifier file:../peer.',
      },
    ]);
  });

  test.each([
    [
      'dependency',
      { dependencies: { 'invalid-dependency': 'workspace:*' } },
      'dependencies.invalid-dependency uses consumer-invalid dependency specifier workspace:*.',
    ],
    [
      'peer dependency',
      { peerDependencies: { 'invalid-peer': 'file:../peer' } },
      'peerDependencies.invalid-peer uses consumer-invalid dependency specifier file:../peer.',
    ],
  ])('rejects an invalid %s protocol before installing the packed consumer', async (_label, manifest, expectedError) => {
    const tarball = await createTarball(
      '@fixture/consumer-protocol',
      {
        ...manifest,
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        },
      },
      { 'dist/index.d.ts': 'export {};', 'dist/index.js': 'export {};' },
    );

    const result = await installPackedConsumer(
      [{ name: '@fixture/consumer-protocol', tarball }],
      await temporaryRoot(),
    );

    expect(result.errors).toEqual([
      `@fixture/consumer-protocol: ${expectedError}`,
    ]);
  });

  test.each([
    ['null', null],
    ['string', 'package'],
    ['number', 1],
    ['boolean', true],
    ['malformed dependencies', { name: '@fixture/invalid', dependencies: [] }],
  ])('returns structured errors for a %s packed manifest', async (_label, manifest) => {
    const tarball = await createTarballWithManifest(
      '@fixture/invalid',
      JSON.stringify(manifest),
      {},
    );

    const report = await auditPackedPackage(tarball);
    const consumer = await installPackedConsumer(
      [{ name: '@fixture/invalid', tarball }],
      await temporaryRoot(),
    );

    expect(report.errors.map(({ rule }) => rule)).toEqual(['invalid-tarball']);
    expect(consumer.errors).toHaveLength(1);
    expect(consumer.errors[0]).toContain('Invalid package/package.json');
  });
});

describe('package selection', () => {
  test('discovers only named non-private packages under packages', async () => {
    const workspace = await createDeclarationAuditWorkspace();
    await writePublishableFixture(workspace);
    await write(
      join(workspace, 'packages/private/package.json'),
      JSON.stringify({
        name: '@fixture/private',
        version: '1.0.0',
        private: true,
      }),
    );
    await write(
      join(workspace, 'packages/unnamed/package.json'),
      JSON.stringify({ version: '1.0.0' }),
    );
    await write(
      join(workspace, 'packages/malformed/package.json'),
      '{not json',
    );

    const result = runDeclarationAudit(workspace);

    expect(result.exitCode, result.stdout.toString()).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(JSON.parse(result.stdout.toString()).errors).toEqual([]);
  }, 30_000);

  test('applies package filters after discovery and rejects excluded names', async () => {
    const workspace = await createDeclarationAuditWorkspace();
    await writePublishableFixture(workspace);
    await write(
      join(workspace, 'packages/private/package.json'),
      JSON.stringify({
        name: '@fixture/private',
        version: '1.0.0',
        private: true,
      }),
    );

    const selected = runDeclarationAudit(workspace, [
      '--packages=@fixture/publishable',
    ]);
    const excluded = runDeclarationAudit(workspace, [
      '--packages=@fixture/private,@fixture/unknown',
    ]);

    expect(selected.exitCode, selected.stdout.toString()).toBe(0);
    expect(JSON.parse(selected.stdout.toString()).errors).toEqual([]);
    expect(excluded.exitCode).toBe(2);
    expect(excluded.stderr.toString()).toBe(
      'Unknown public package selection: @fixture/private, @fixture/unknown.\n',
    );
  }, 30_000);

  test('both audit CLIs reject the same mixed package selection', () => {
    const selection =
      '--packages=@maelstrom-co/protocol,@maelstrom-co/does-not-exist';

    for (const [path, mode] of [
      ['audit.ts', '--declarations'],
      ['strip-internal-comparison.ts', undefined],
    ] as const) {
      const result = runTool(path, mode ? [mode, selection] : [selection]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toBe(
        'Unknown public package selection: @maelstrom-co/does-not-exist.\n',
      );
    }
  }, 30_000);

  test('the audit CLI rejects a package filter in TypeDoc-only mode', () => {
    const result = runTool('audit.ts', [
      '--typedoc',
      '--packages=@maelstrom-co/protocol',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      '--packages requires --declarations; TypeDoc artifacts are audited as one unfiltered set.',
    );
  });

  test.each([
    [['--packed-consumer']],
    [['--typedoc', '--packed-consumer']],
  ])('the audit CLI rejects packed consumer checks without declarations: %p', (arguments_) => {
    const result = runTool('audit.ts', arguments_);

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      '--packed-consumer requires --declarations.',
    );
  });
});

test('stripInternal comparison distinguishes identical output from rejected drift', async () => {
  const clean = await emitDeclaration(
    '/** Public. */\nexport interface PublicValue { value: string }',
  );
  const cleanResult = await compareStripInternal(
    join(clean.root, 'tsconfig.json'),
    await temporaryRoot(),
  );
  expect(cleanResult.status).toBe('identical');

  const tagged = await emitDeclaration(
    '/** @internal */\nexport interface InternalValue { value: string }\nexport interface PublicValue { item: InternalValue }',
  );
  const taggedResult = await compareStripInternal(
    join(tagged.root, 'tsconfig.json'),
    await temporaryRoot(),
  );
  expect(taggedResult.status).toBe('drift-rejected');
}, 30_000);

test('stripInternal comparison supports composite package configurations', async () => {
  const root = await temporaryRoot();
  await write(
    join(root, 'src/index.ts'),
    '/** Public value. */\nexport interface PublicValue { value: string }',
  );
  await write(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { composite: true, declaration: true, outDir: 'dist' },
      include: ['src/**/*.ts'],
    }),
  );

  const outputRoot = await temporaryRoot();
  await write(join(outputRoot, 'ordinary/stale.d.ts'), 'export {};');
  const result = await compareStripInternal(
    join(root, 'tsconfig.json'),
    outputRoot,
  );

  expect(result.status).toBe('identical');
}, 30_000);

test('stripInternal comparison supports source imports with TypeScript extensions', async () => {
  const root = await temporaryRoot();
  await write(
    join(root, 'src/index.ts'),
    "export { value } from './value.ts';",
  );
  await write(join(root, 'src/value.ts'), 'export const value = 1;');
  await write(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        declaration: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        outDir: 'dist',
        rewriteRelativeImportExtensions: true,
      },
      include: ['src/**/*.ts'],
    }),
  );

  const result = await compareStripInternal(
    join(root, 'tsconfig.json'),
    await temporaryRoot(),
  );

  expect(result.status).toBe('identical');
  expect(result.inputCount).toBe(2);
}, 30_000);

test('stripInternal comparison does not create the configured tsbuildinfo cache', async () => {
  const root = await temporaryRoot();
  const configuredCache = join(root, 'cache/package.tsbuildinfo');
  await write(
    join(root, 'src/index.ts'),
    '/** Public value. */\nexport interface PublicValue { value: string }',
  );
  await write(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        composite: true,
        declaration: true,
        outDir: 'dist',
        tsBuildInfoFile: configuredCache,
      },
      include: ['src/**/*.ts'],
    }),
  );

  const result = await compareStripInternal(
    join(root, 'tsconfig.json'),
    await temporaryRoot(),
  );

  expect(result.status).toBe('identical');
  expect(await Bun.file(configuredCache).exists()).toBe(false);
}, 30_000);

test('declaration audit reports missing build output before packing', async () => {
  const workspace = await temporaryRoot();
  const packageRoot = join(workspace, 'packages/unbuilt');
  await write(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  );
  await write(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@fixture/unbuilt',
      version: '1.0.0',
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      },
      files: ['dist'],
      publishConfig: { access: 'public' },
    }),
  );
  await copyAuditCli(workspace);
  await symlink(
    join(import.meta.dir, '../../node_modules'),
    join(workspace, 'node_modules'),
  );

  const result = Bun.spawnSync(
    [
      process.execPath,
      join(workspace, 'tools/public-api-docs/audit.ts'),
      '--declarations',
      '--packages=@fixture/unbuilt',
    ],
    { cwd: workspace, stderr: 'pipe', stdout: 'pipe' },
  );

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout.toString()).errors).toEqual([
    {
      path: '@fixture/unbuilt:./dist/index.d.ts',
      rule: 'missing-package-build-output',
      message:
        'Package build output ./dist/index.d.ts does not exist; build @fixture/unbuilt before running the declaration audit.',
      target: './dist/index.d.ts',
    },
    {
      path: '@fixture/unbuilt:./dist/index.js',
      rule: 'missing-package-build-output',
      message:
        'Package build output ./dist/index.js does not exist; build @fixture/unbuilt before running the declaration audit.',
      target: './dist/index.js',
    },
  ]);
}, 30_000);
