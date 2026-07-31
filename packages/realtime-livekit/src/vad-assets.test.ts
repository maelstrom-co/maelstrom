import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as actualFs from 'node:fs/promises';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, relative } from 'node:path';

import { copyLiveKitVadAssets } from './vad-assets.js';

const realFs = {
  copyFile: actualFs.copyFile.bind(actualFs),
  lstat: actualFs.lstat.bind(actualFs),
  readdir: actualFs.readdir.bind(actualFs),
  rename: actualFs.rename.bind(actualFs),
  rm: actualFs.rm.bind(actualFs),
};

const expectedAssets = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'silero_vad_legacy.onnx',
  'silero_vad_v5.onnx',
  'vad.worklet.bundle.min.js',
];

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-livekit-assets-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('copyLiveKitVadAssets', () => {
  test('copies the complete pinned manifest and returns sorted relative slash paths', async () => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'public', 'vad-web');

    const copiedPaths = await copyLiveKitVadAssets({ outputDir });

    expect(copiedPaths).toEqual(expectedAssets);
    expect((await readdir(outputDir)).sort()).toEqual(expectedAssets);
    expect(
      copiedPaths.every(
        (path) => !path.startsWith('/') && !path.includes('\\'),
      ),
    ).toBe(true);
    expect(
      await readFile(join(outputDir, 'vad.worklet.bundle.min.js')),
    ).not.toHaveLength(0);
  });

  test('resolves a relative output directory from the caller current working directory', async () => {
    const root = await createTempDirectory();
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      await copyLiveKitVadAssets({ outputDir: 'public/vad-web' });
    } finally {
      process.chdir(previousCwd);
    }

    expect((await readdir(join(root, 'public', 'vad-web'))).sort()).toEqual(
      expectedAssets,
    );
  });

  test('rejects the caller current working directory without replacing it', async () => {
    const root = await createTempDirectory();
    const sentinel = join(root, 'keep.txt');
    const originalDirectory = await lstat(root);
    const previousCwd = process.cwd();
    await writeFile(sentinel, 'keep');
    process.chdir(root);

    let error: unknown;
    try {
      await copyLiveKitVadAssets({ outputDir: '.' });
    } catch (caught) {
      error = caught;
    } finally {
      process.chdir(previousCwd);
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'outputDir must be a dedicated child directory',
    );
    expect((await lstat(root)).ino).toBe(originalDirectory.ino);
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
  });

  test.each([
    '..',
    '../..',
  ])('rejects resolved ancestor %s without replacing it', async (outputDir) => {
    const root = await createTempDirectory();
    const cwd = join(root, 'parent', 'workdir');
    const resolvedOutputDir = join(cwd, outputDir);
    const sentinel = join(resolvedOutputDir, 'keep.txt');
    await mkdir(cwd, { recursive: true });
    await writeFile(sentinel, 'keep');
    const originalDirectory = await lstat(resolvedOutputDir);
    const previousCwd = process.cwd();
    process.chdir(cwd);

    let error: unknown;
    try {
      await copyLiveKitVadAssets({ outputDir });
    } catch (caught) {
      error = caught;
    } finally {
      process.chdir(previousCwd);
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'outputDir must be a dedicated child directory',
    );
    expect((await lstat(resolvedOutputDir)).ino).toBe(originalDirectory.ino);
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
  });

  test('replaces stale destination files only after the complete manifest is staged', async () => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'vad-web');
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'stale.wasm'), 'stale');

    await copyLiveKitVadAssets({ outputDir });

    expect((await readdir(outputDir)).sort()).toEqual(expectedAssets);
  });

  test('rejects a filesystem root', async () => {
    const root = parse(process.cwd()).root;

    await expect(copyLiveKitVadAssets({ outputDir: root })).rejects.toThrow(
      'outputDir must not be a filesystem root',
    );
  });

  test('rejects an existing symlink without changing its target', async () => {
    const root = await createTempDirectory();
    const target = join(root, 'target');
    const outputDir = join(root, 'vad-web');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep');
    await symlink(target, outputDir);

    await expect(copyLiveKitVadAssets({ outputDir })).rejects.toThrow(
      'outputDir must not be a symbolic link',
    );
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

  test('rejects an existing non-directory target', async () => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'vad-web');
    await writeFile(outputDir, 'keep');

    await expect(copyLiveKitVadAssets({ outputDir })).rejects.toThrow(
      'outputDir must be a directory',
    );
    expect(await readFile(outputDir, 'utf8')).toBe('keep');
  });

  test('leaves no sibling transaction artifacts after success', async () => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'vad-web');

    await copyLiveKitVadAssets({ outputDir });

    expect(
      (await readdir(root)).filter((name) => name.startsWith('.vad-web.')),
    ).toEqual([]);
  });

  test('keeps the Node helper outside the browser root entry', async () => {
    const packageRoot = join(import.meta.dir, '..');
    const rootEntry = await readFile(join(import.meta.dir, 'index.ts'), 'utf8');
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };

    expect(rootEntry).not.toContain('vad-assets');
    expect(rootEntry).not.toContain('node:fs');
    expect(rootEntry).not.toContain('node:path');
    expect(packageJson.exports['./vad-assets']).toBeDefined();
  });

  test('does not write outside the requested destination', async () => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'nested', 'vad-web');

    const copiedPaths = await copyLiveKitVadAssets({ outputDir });

    for (const path of copiedPaths) {
      expect(relative(outputDir, join(outputDir, path)).startsWith('..')).toBe(
        false,
      );
    }
    expect((await lstat(outputDir)).isDirectory()).toBe(true);
  });

  test.each([
    'backup',
    'stage',
  ])('rejects a stale helper-owned %s artifact before mutating the destination', async (kind) => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'vad-web');
    const artifactName = `.vad-web.${kind}-123e4567-e89b-42d3-a456-426614174000`;
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'prior.txt'), 'prior');
    await mkdir(join(root, artifactName));

    await expect(copyLiveKitVadAssets({ outputDir })).rejects.toThrow(
      'stale browser VAD asset transaction artifact',
    );

    expect(await readdir(outputDir)).toEqual(['prior.txt']);
    expect((await readdir(root)).sort()).toEqual(
      [artifactName, 'vad-web'].sort(),
    );
  });

  test('ignores sibling names outside the helper-owned transaction format', async () => {
    const root = await createTempDirectory();
    const outputDir = join(root, 'vad-web');
    const unrelatedName = '.vad-web.backup-interrupted';
    await mkdir(join(root, unrelatedName));

    await copyLiveKitVadAssets({ outputDir });

    expect((await readdir(outputDir)).sort()).toEqual(expectedAssets);
    expect((await lstat(join(root, unrelatedName))).isDirectory()).toBe(true);
  });

  test('preserves the correct destination across injected transaction failures', async () => {
    type FailurePoint =
      | 'discovery'
      | 'staged-copy'
      | 'manifest-validation'
      | 'backup-rename'
      | 'replacement-rename'
      | 'backup-removal'
      | 'cleanup';

    const fault: {
      point?: FailurePoint;
      backupRemovalFailed: boolean;
      cleanupFailed: boolean;
    } = { backupRemovalFailed: false, cleanupFailed: false };
    mock.module('node:fs/promises', () => ({
      ...actualFs,
      copyFile: async (source: string, destination: string) => {
        if (fault.point === 'staged-copy' || fault.point === 'cleanup') {
          throw new Error(`injected ${fault.point} failure`);
        }
        return realFs.copyFile(source, destination);
      },
      lstat: async (path: string) => {
        if (fault.point === 'discovery') {
          throw new Error('injected discovery failure');
        }
        return realFs.lstat(path);
      },
      readdir: async (path: string) => {
        if (fault.point === 'manifest-validation' && path.includes('.stage-')) {
          throw new Error('injected manifest-validation failure');
        }
        return realFs.readdir(path);
      },
      rename: async (source: string, destination: string) => {
        if (
          fault.point === 'backup-rename' &&
          destination.includes('.backup-')
        ) {
          throw new Error('injected backup-rename failure');
        }
        if (
          fault.point === 'replacement-rename' &&
          source.includes('.stage-')
        ) {
          fault.point = undefined;
          throw new Error('injected replacement-rename failure');
        }
        return realFs.rename(source, destination);
      },
      rm: async (path: string, options: Parameters<typeof actualFs.rm>[1]) => {
        if (fault.point === 'backup-removal' && path.includes('.backup-')) {
          if (!fault.backupRemovalFailed) {
            fault.backupRemovalFailed = true;
            await realFs.rm(join(path, 'prior.txt'), { force: true });
          }
          throw new Error('injected backup-removal failure');
        }
        if (
          fault.point === 'cleanup' &&
          path.includes('.stage-') &&
          !fault.cleanupFailed
        ) {
          fault.cleanupFailed = true;
          throw new Error('injected cleanup failure');
        }
        return realFs.rm(path, options);
      },
    }));

    try {
      const modulePath = './vad-assets.ts?fault-injection';
      const faultInjectedModule = (await import(
        modulePath
      )) as typeof import('./vad-assets.js');

      for (const point of [
        'discovery',
        'staged-copy',
        'manifest-validation',
        'backup-rename',
        'replacement-rename',
        'backup-removal',
        'cleanup',
      ] satisfies FailurePoint[]) {
        const root = await createTempDirectory();
        const outputDir = join(root, 'vad-web');
        await mkdir(outputDir);
        await writeFile(join(outputDir, 'prior.txt'), 'prior');
        fault.point = point;
        fault.backupRemovalFailed = false;
        fault.cleanupFailed = false;

        if (point === 'backup-removal') {
          await writeFile(join(outputDir, 'prior-retained.txt'), 'retained');
          await expect(
            faultInjectedModule.copyLiveKitVadAssets({ outputDir }),
          ).rejects.toThrow('backup cleanup failed');

          expect((await readdir(outputDir)).sort()).toEqual(expectedAssets);
          const transactionArtifacts = (await readdir(root)).filter((name) =>
            name.startsWith('.vad-web.backup-'),
          );
          expect(transactionArtifacts).toHaveLength(1);
          expect(
            await readFile(
              join(root, transactionArtifacts[0]!, 'prior-retained.txt'),
              'utf8',
            ),
          ).toBe('retained');
          await expect(
            lstat(join(root, transactionArtifacts[0]!, 'prior.txt')),
          ).rejects.toThrow();
        } else {
          await expect(
            faultInjectedModule.copyLiveKitVadAssets({ outputDir }),
          ).rejects.toThrow(`injected ${point}`);

          expect(await readFile(join(outputDir, 'prior.txt'), 'utf8')).toBe(
            'prior',
          );
          expect(await readdir(outputDir)).toEqual(['prior.txt']);
          expect(
            (await readdir(root)).filter((name) =>
              name.startsWith('.vad-web.'),
            ),
          ).toEqual([]);
        }
      }
    } finally {
      mock.restore();
    }
  });
});
