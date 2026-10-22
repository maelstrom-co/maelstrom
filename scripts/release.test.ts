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

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture({ firstRelease = false } = {}) {
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
    release: {
      projects: ['sdk'],
      projectsRelationship: 'fixed',
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
    version: firstRelease ? '0.1.0-alpha.8' : '0.1.0',
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
  writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n.nx/\n');
  symlinkSync(resolve('node_modules'), join(cwd, 'node_modules'));
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-b', 'release/preparation']);
  git(['config', 'user.email', 'fixture@example.com']);
  git(['config', 'user.name', 'Release fixture']);
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'feat: add sdk']);
  if (!firstRelease) git(['tag', 'v0.1.0']);
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
    spawnSync(process.execPath, [resolve('scripts/release.ts'), ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        NX_DAEMON: 'false',
        NX_ISOLATE_PLUGINS: 'false',
        NX_NO_CLOUD: 'true',
        NX_TUI: 'false',
      },
    });
  return { cwd, git, head, tags, calls, run };
}

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

test('the first public release graduates the existing alpha to stable 0.1.0 without remote operations', () => {
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
