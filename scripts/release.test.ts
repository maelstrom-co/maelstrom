import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertNoProtocolLiterals,
  substituteManifest,
} from './publish-packages.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture({
  firstRelease = false,
  initialVersion = '0.1.0',
  withSharedPackage = false,
} = {}) {
  const { releaseTag } = JSON.parse(
    readFileSync(resolve('nx.json'), 'utf8'),
  ).release;
  const root = mkdtempSync(join(tmpdir(), 'release-pr-'));
  roots.push(root);
  const cwd = join(root, 'repo');
  mkdirSync(join(cwd, 'packages/sdk'), { recursive: true });
  const write = (path: string, value: unknown) =>
    writeFileSync(join(cwd, path), JSON.stringify(value, null, 2));
  write('package.json', {
    name: 'release-fixture',
    private: true,
    workspaces: ['packages/*'],
  });
  write('nx.json', {
    cli: { packageManager: 'bun' },
    release: {
      projects: withSharedPackage ? ['sdk', 'shared'] : ['sdk'],
      projectsRelationship: 'fixed',
      releaseTag,
      version: {
        currentVersionResolver: 'git-tag',
        specifierSource: 'conventional-commits',
        versionActionsOptions: { skipLockFileUpdate: true },
        git: { commit: true, tag: true, push: true, stageChanges: true },
      },
      changelog: {
        workspaceChangelog: {
          file: false,
          createRelease: 'github',
          renderer: resolve('scripts/lib/release-changelog-renderer.ts'),
        },
        projectChangelogs: false,
        git: { commit: true, tag: true, push: true, stageChanges: true },
      },
    },
  });
  write('packages/sdk/package.json', {
    name: '@maelstrom-co/sdk',
    version: firstRelease ? '0.1.0-alpha.8' : initialVersion,
    nx: { name: 'sdk' },
    description: 'A release fixture',
    keywords: ['ui', 'ai', 'sdk'],
    license: 'MIT',
    homepage: 'https://maelstrom-ai.co',
    bugs: { url: 'https://github.com/maelstrom-co/maelstrom/issues' },
    repository: {
      url: 'https://github.com/maelstrom-co/maelstrom.git',
      directory: 'packages/sdk',
    },
    publishConfig: { registry: 'https://registry.npmjs.org', access: 'public' },
  });
  writeFileSync(join(cwd, 'packages/sdk/README.md'), '# SDK\n');
  writeFileSync(join(cwd, 'packages/sdk/LICENSE'), 'MIT\n');
  if (withSharedPackage) {
    const sdk = JSON.parse(
      readFileSync(join(cwd, 'packages/sdk/package.json'), 'utf8'),
    );
    mkdirSync(join(cwd, 'packages/shared'));
    write('packages/shared/package.json', {
      ...sdk,
      name: '@maelstrom-co/shared',
      nx: { name: 'shared' },
      repository: { ...sdk.repository, directory: 'packages/shared' },
    });
    writeFileSync(join(cwd, 'packages/shared/README.md'), '# Shared\n');
    writeFileSync(join(cwd, 'packages/shared/LICENSE'), 'MIT\n');
    write('packages/sdk/package.json', {
      ...sdk,
      dependencies: { '@maelstrom-co/shared': sdk.version },
      devDependencies: { '@maelstrom-co/shared': 'workspace:*' },
      optionalDependencies: { '@maelstrom-co/shared': 'workspace:*' },
      peerDependencies: {
        '@maelstrom-co/shared': 'workspace:*',
        react: '^19.0.0',
      },
    });
  }
  writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n.nx/\n');
  symlinkSync(resolve('node_modules'), join(cwd, 'node_modules'));
  // User signing defaults can turn a lightweight fixture tag into an editor prompt.
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_EDITOR: 'false',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (args: string[]) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
    if (result.status !== 0)
      throw new Error(
        `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`,
      );
    return result.stdout.trim();
  };
  git(['init', '-b', 'release/preparation']);
  git(['config', 'user.email', 'fixture@example.com']);
  git(['config', 'user.name', 'Release fixture']);
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'feat: add sdk']);
  if (!firstRelease) git(['tag', `v${initialVersion}`]);
  writeFileSync(
    join(cwd, 'packages/sdk/README.md'),
    '# SDK\n\nA corrected example.\n',
  );
  git(['add', '.']);
  git([
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fix: correct sdk example',
  ]);
  const head = git(['rev-parse', 'HEAD']);
  const tags = git(['tag', '--list']);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const calls = join(root, 'remote-calls');
  // A release preparation must not contact accounts, even if credentials exist.
  for (const tool of ['gh', 'npm']) {
    const path = join(bin, tool);
    writeFileSync(path, `#!/bin/sh\necho ${tool} >> '${calls}'\nexit 1\n`);
    chmodSync(path, 0o755);
  }
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['--no-env-file', resolve('scripts/release.ts'), ...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...env,
          PATH: `${bin}:${process.env.PATH}`,
          NX_DAEMON: 'false',
          NX_LOAD_DOT_ENV_FILES: 'false',
          NX_ISOLATE_PLUGINS: 'false',
          NX_NO_CLOUD: 'true',
          NX_TUI: 'false',
        },
      },
    );
  return { cwd, git, head, tags, calls, run };
}

test('fixture tags stay lightweight despite user signing defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-git-config-'));
  roots.push(root);
  const config = join(root, 'gitconfig');
  writeFileSync(config, '[tag]\n  gpgSign = true\n[core]\n  editor = false\n');
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  try {
    const f = fixture();
    expect(f.git(['cat-file', '-t', 'refs/tags/v0.1.0'])).toBe('commit');
    const result = f.run('--version', '0.2.0', '--dry-run');
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(f.git(['status', '--porcelain'])).toBe('');
    expect(existsSync(f.calls)).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  }
}, 40000);

test('prepares reviewable versions and notes without staging, committing, tagging, pushing, or publishing', () => {
  const f = fixture();
  const result = f.run('--version', '0.2.0');
  expect(result.stderr + result.stdout).toContain('Prepared 0.2.0.');
  expect(result.status).toBe(0);
  expect(
    JSON.parse(readFileSync(join(f.cwd, 'packages/sdk/package.json'), 'utf8'))
      .version,
  ).toBe('0.2.0');
  expect(
    readFileSync(join(f.cwd, '.github/releases/v0.2.0.md'), 'utf8'),
  ).toContain('correct sdk example');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.head);
  expect(f.git(['tag', '--list'])).toBe(f.tags);
  expect(f.git(['diff', '--cached', '--name-only'])).toBe('');
  expect(existsSync(f.calls)).toBe(false);
}, 40000);

test('rehearses the same preparation without changing manifests or writing notes', () => {
  const f = fixture();
  const result = f.run('--version', '0.2.0', '--dry-run');
  expect(result.stderr + result.stdout).toContain(
    'Would write .github/releases/v0.2.0.md',
  );
  expect(result.status).toBe(0);
  expect(f.git(['status', '--porcelain'])).toBe('');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.head);
  expect(f.git(['tag', '--list'])).toBe(f.tags);
  expect(existsSync(f.calls)).toBe(false);
}, 40000);

test('rejects the removed publish flag before changing release files', () => {
  const f = fixture();
  const result = f.run('--skip-publish');
  expect(result.status).not.toBe(0);
  expect(f.git(['status', '--porcelain'])).toBe('');
  expect(existsSync(f.calls)).toBe(false);
}, 40000);

test('explicit prerelease preparation keeps the inferred release on its requested channel', () => {
  const f = fixture();
  const rehearsal = f.run('--preid', 'alpha', '--dry-run');
  expect(rehearsal.status, rehearsal.stderr + rehearsal.stdout).toBe(0);
  expect(f.git(['status', '--porcelain'])).toBe('');
  const prepared = f.run('--preid', 'alpha');
  expect(prepared.status, prepared.stderr + prepared.stdout).toBe(0);
  expect(
    JSON.parse(readFileSync(join(f.cwd, 'packages/sdk/package.json'), 'utf8'))
      .version,
  ).toBe('0.1.1-alpha.0');
  expect(
    readFileSync(join(f.cwd, '.github/releases/v0.1.1-alpha.0.md'), 'utf8'),
  ).toContain('correct sdk example');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.head);
  expect(f.git(['tag', '--list'])).toBe(f.tags);
  expect(existsSync(f.calls)).toBe(false);
}, 40000);

test('a first-ever release can prepare stable 0.1.0 from an untagged alpha without remote operations', () => {
  const f = fixture({ firstRelease: true });
  const rehearsal = f.run('--version', '0.1.0', '--first-release', '--dry-run');
  expect(rehearsal.status, rehearsal.stderr + rehearsal.stdout).toBe(0);
  expect(rehearsal.stdout).toContain('Would write .github/releases/v0.1.0.md');
  expect(f.git(['status', '--porcelain'])).toBe('');

  const prepared = f.run('--version', '0.1.0', '--first-release');
  expect(prepared.status, prepared.stderr + prepared.stdout).toBe(0);
  expect(
    JSON.parse(readFileSync(join(f.cwd, 'packages/sdk/package.json'), 'utf8'))
      .version,
  ).toBe('0.1.0');
  expect(
    readFileSync(join(f.cwd, '.github/releases/v0.1.0.md'), 'utf8'),
  ).toContain('correct sdk example');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.head);
  expect(f.git(['tag', '--list'])).toBe('');
  expect(f.git(['diff', '--cached', '--name-only'])).toBe('');
  expect(existsSync(f.calls)).toBe(false);
}, 40000);

test('the first public release graduates the tagged alpha without deleting history or publishing', () => {
  const f = fixture({ initialVersion: '0.1.0-alpha.8' });
  const rehearsal = f.run('--version', '0.1.0', '--dry-run');
  expect(rehearsal.status, rehearsal.stderr + rehearsal.stdout).toBe(0);
  expect(f.git(['status', '--porcelain'])).toBe('');

  const prepared = f.run('--version', '0.1.0');
  expect(prepared.status, prepared.stderr + prepared.stdout).toBe(0);
  expect(
    JSON.parse(readFileSync(join(f.cwd, 'packages/sdk/package.json'), 'utf8'))
      .version,
  ).toBe('0.1.0');
  expect(
    readFileSync(join(f.cwd, '.github/releases/v0.1.0.md'), 'utf8'),
  ).toContain('correct sdk example');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.head);
  expect(f.git(['tag', '--list'])).toBe('v0.1.0-alpha.8');
  expect(f.git(['diff', '--cached', '--name-only'])).toBe('');
  expect(existsSync(f.calls)).toBe(false);
}, 40000);

test('stable preparation does not require alpha packages to install an internal dependency', () => {
  const f = fixture({
    initialVersion: '0.1.0-alpha.8',
    withSharedPackage: true,
  });
  const rehearsal = f.run('--version', '0.1.0', '--dry-run');
  expect(rehearsal.status, rehearsal.stderr + rehearsal.stdout).toBe(0);
  expect(f.git(['status', '--porcelain'])).toBe('');

  const prepared = f.run('--version', '0.1.0');
  expect(prepared.status, prepared.stderr + prepared.stdout).toBe(0);
  const sdk = JSON.parse(
    readFileSync(join(f.cwd, 'packages/sdk/package.json'), 'utf8'),
  );
  const shared = JSON.parse(
    readFileSync(join(f.cwd, 'packages/shared/package.json'), 'utf8'),
  );
  expect(sdk.version).toBe('0.1.0');
  expect(shared.version).toBe('0.1.0');
  expect(sdk.dependencies['@maelstrom-co/shared']).toBe('0.1.0');
  expect(sdk.peerDependencies['@maelstrom-co/shared']).toBe('workspace:*');
  const published = substituteManifest(
    {
      catalog: {},
      workspaceVersions: new Map([
        [sdk.name, sdk.version],
        [shared.name, shared.version],
      ]),
    },
    sdk,
  );
  assertNoProtocolLiterals(published);
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const) {
    expect(published[field]?.['@maelstrom-co/shared']).toBe('0.1.0');
  }
  expect(published.peerDependencies?.react).toBe('^19.0.0');
  expect(f.git(['rev-parse', 'HEAD'])).toBe(f.head);
  expect(f.git(['tag', '--list'])).toBe(f.tags);
  expect(f.git(['diff', '--cached', '--name-only'])).toBe('');
  expect(existsSync(f.calls)).toBe(false);
}, 40000);
