import { afterEach, describe, expect, test } from 'bun:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureProject,
  prepareFixtures,
  prepareTrials,
} from './prepare-trials.mjs';

let temporaryRoots = [];

async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryRoots = [];
});

describe('trial bootstrap', () => {
  test('copies canonical fixtures and constructs byte-identical paired migration workspaces', async () => {
    const root = await temporaryDirectory('trial workspace with spaces ');
    const trialRoot = join(root, 'scratch trials with spaces');
    const fixtures = join(root, 'apps/docs/prompts/acceptance/fixtures');
    await cp(join(import.meta.dir, 'fixtures'), fixtures, { recursive: true });

    const prepared = await prepareFixtures(root, trialRoot);

    expect(prepared.projects.migrationInventory).toBe(
      join(trialRoot, 'migration-inventory'),
    );
    expect(prepared.projects.migrationConversion).toBe(
      join(trialRoot, 'migration-conversion'),
    );
    for (const path of [
      'index.html',
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'src/App.tsx',
      'src/main.tsx',
      'src/SearchPanel.tsx',
      'src/search.ts',
      'src/SearchPanel.test.tsx',
      'src/testConnector.ts',
      '.trial/noop',
      '.trial/sdk-probe.tsx',
      '.trial/sdk-runtime.ts',
    ]) {
      const fixturePath = join(
        fixtures,
        'migration-react',
        path === 'package.json' ? 'package.json.fixture' : path,
      );
      for (const project of ['migration-inventory', 'migration-conversion']) {
        expect(await readFile(join(trialRoot, project, path))).toEqual(
          await readFile(fixturePath),
        );
      }
    }
    expect(await readFile(join(trialRoot, 'onboarding/package.json'))).toEqual(
      await readFile(join(fixtures, 'onboarding-react/package.json.fixture')),
    );
    expect(await readFile(join(trialRoot, 'onboarding/tsconfig.json'))).toEqual(
      await readFile(join(fixtures, 'onboarding-react/tsconfig.json')),
    );
    expect(await readFile(join(trialRoot, 'onboarding/project.json'))).toEqual(
      await readFile(join(fixtures, 'onboarding-react/project.json.fixture')),
    );
    for (const path of [
      'onboarding/src/App.tsx',
      'onboarding/project.json',
      'modeling/src/Queue.tsx',
      'debugging/report.md',
      'migration-inventory/src/testConnector.ts',
      'migration-inventory/.trial/sdk-runtime.ts',
      'migration-inventory/.trial/sdk-probe.tsx',
      'migration-inventory/src/SearchPanel.test.tsx',
      'onboarding/.trial/sdk-runtime.ts',
      'onboarding/.trial/sdk-probe.tsx',
      'onboarding/src/testConnector.ts',
    ])
      await expect(
        readFile(join(trialRoot, path), 'utf8'),
      ).resolves.toBeTruthy();
    const left = join(trialRoot, 'migration-inventory');
    const right = join(trialRoot, 'migration-conversion');
    for (const path of [
      'src/SearchPanel.tsx',
      'src/search.ts',
      'package.json',
      'src/SearchPanel.test.tsx',
      'src/testConnector.ts',
    ]) {
      expect(await readFile(join(left, path))).toEqual(
        await readFile(join(right, path)),
      );
    }
    expect(
      await readFile(join(trialRoot, 'onboarding/src/App.tsx'), 'utf8'),
    ).toContain('Review the open support queue');
    expect(
      await readFile(
        join(trialRoot, 'migration-inventory/src/testConnector.ts'),
        'utf8',
      ),
    ).toContain('never contacts a live Engine');
  });

  test('wires local SDK archive dependencies and checks archives exist without shell interpolation', async () => {
    const root = await temporaryDirectory('trial config with spaces ');
    const project = join(root, 'trial project');
    const vendor = join(root, 'vendor archives with spaces');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(join(project, 'vendor'), { recursive: true }),
    );
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(vendor, { recursive: true }),
    );
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ dependencies: {}, devDependencies: {} }),
    );
    for (const name of ['react', 'client', 'protocol', 'connectors']) {
      await writeFile(
        join(vendor, `maelstrom-co-${name}-0.1.0-alpha.4.tgz`),
        'fixture archive',
      );
    }

    await configureProject(project, vendor);

    const manifest = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    );
    expect(manifest.dependencies['@maelstrom-co/react']).toBe(
      'file:./vendor/maelstrom-co-react-0.1.0-alpha.4.tgz',
    );
    expect(manifest.overrides['@maelstrom-co/protocol']).toBe(
      'file:./vendor/maelstrom-co-protocol-0.1.0-alpha.4.tgz',
    );
    expect(manifest.devDependencies.react).toBe('19.2.8');
    await rm(join(vendor, 'maelstrom-co-client-0.1.0-alpha.4.tgz'));
    await expect(configureProject(project, vendor)).rejects.toThrow(
      'Missing local SDK tarball client',
    );
  });

  test('CLI accepts workspace and temp-parent arguments literally and retains failed scratch setup', async () => {
    const root = await temporaryDirectory('trial cli workspace with spaces ');
    const workspace = join(root, 'workspace with spaces');
    const parent = join(root, 'scratch parent with spaces');
    await mkdir(workspace);
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        '--no-env-file',
        join(import.meta.dir, 'prepare-trials.mjs'),
        workspace,
        parent,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 20_000,
      killSignal: 'SIGKILL',
    });
    const stdout = result.stdout.toString();
    expect(
      result.exitedDueToTimeout,
      `CLI timed out after 20s\nstdout:\n${stdout}\nstderr:\n${result.stderr.toString()}`,
    ).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(stdout).toContain('TRIAL_ROOT=');
    const trialRoot = stdout.match(/TRIAL_ROOT=(.+)/)?.[1]?.trim();
    expect(trialRoot).toContain(parent);
    expect(await readdir(parent)).toContain(trialRoot.split('/').at(-1));
    expect(result.stderr.toString()).toContain('npm');
  }, 30_000);

  test('rejects a scratch parent inside the workspace before allocating a trial directory', async () => {
    const workspace = await temporaryDirectory('trial contained scratch ');
    const parent = join(workspace, 'inside checkout');
    await expect(prepareTrials(workspace, parent)).rejects.toThrow(
      'TEMP_PARENT must be outside the workspace checkout',
    );
    expect(await readdir(parent)).toEqual([]);
  });

  test('CLI reports missing required workspace argument', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, 'prepare-trials.mjs')],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      'Usage: node apps/docs/prompts/acceptance/prepare-trials.mjs',
    );
  });
});
