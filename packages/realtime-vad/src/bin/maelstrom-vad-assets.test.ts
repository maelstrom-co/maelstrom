import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runVadAssetsCli } from './maelstrom-vad-assets.js';

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('runVadAssetsCli', () => {
  test('requires exactly one output directory argument', async () => {
    const output = captureOutput();

    const exitCode = await runVadAssetsCli([], output.io);

    expect(exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(['Usage: maelstrom-vad-assets <outputDir>']);
  });

  test('prints only the copied-file count after success', async () => {
    const output = captureOutput();

    const exitCode = await runVadAssetsCli(
      ['public/vad-web'],
      output.io,
      async () => ['a.mjs', 'b.wasm'],
    );

    expect(exitCode).toBe(0);
    expect(output.stdout).toEqual(['Copied 2 browser VAD assets.']);
    expect(output.stderr).toEqual([]);
  });

  test('prints a concise error and no copied-file count after failure', async () => {
    const output = captureOutput();

    const exitCode = await runVadAssetsCli(
      ['public/vad-web'],
      output.io,
      async () => {
        throw new Error('destination is unsafe');
      },
    );

    expect(exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([
      'Failed to copy browser VAD assets: destination is unsafe',
    ]);
  });

  test('redacts absolute paths and control characters from failures', async () => {
    const output = captureOutput();

    const exitCode = await runVadAssetsCli(
      ['public/vad-web'],
      output.io,
      async () => {
        throw new Error(
          "EACCES:\u0000 permission\tdenied\nwhile replacing '/Users/javier/private/vad-web'",
        );
      },
    );

    expect(exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([
      'Failed to copy browser VAD assets: EACCES: permission denied while replacing <path>',
    ]);
    expect(
      [...output.stderr[0]].some((character) => {
        const codePoint = character.codePointAt(0);
        return (
          codePoint !== undefined &&
          (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159))
        );
      }),
    ).toBeFalse();
    expect(output.stderr[0]).not.toContain('/Users/javier');
  });
});

if (process.platform !== 'win32') {
  test('builds package artifacts with an executable bin and external VAD runtimes', () => {
    const packageRoot = resolve(import.meta.dir, '../..');
    const outputDir = mkdtempSync(join(tmpdir(), 'maelstrom-vad-cli-'));

    try {
      const build = spawnSync(
        'bunx',
        [
          'vite',
          'build',
          '--config',
          'vite.config.ts',
          '--outDir',
          outputDir,
          '--logLevel',
          'error',
        ],
        { cwd: packageRoot, encoding: 'utf8' },
      );

      expect(build.status, build.stderr || build.stdout).toBe(0);

      const binPath = resolve(outputDir, 'bin/maelstrom-vad-assets.js');
      expect(statSync(binPath).mode & 0o111).not.toBe(0);
      expect(readFileSync(binPath, 'utf8')).toStartWith(
        '#!/usr/bin/env node\n',
      );

      const browserEntry = readFileSync(resolve(outputDir, 'index.js'), 'utf8');
      expect(browserEntry).toContain('import("@ricky0123/vad-web")');

      const assetEntry = readFileSync(
        resolve(outputDir, 'vad-assets.js'),
        'utf8',
      );
      // Assert the shape, not the bytes: the chunk name carries a content hash
      // and the bindings are minified, so matching them literally turns any
      // edit to `copyBrowserVadAssets` — or a bundler bump — into a failure
      // about bundler output rather than about the change.
      expect(assetEntry).toMatch(/\bas copyBrowserVadAssets\b/);

      const assetEntryImports = [
        ...assetEntry.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ].map(([, specifier]) => specifier);
      expect(assetEntryImports.length).toBeGreaterThan(0);
      expect(
        assetEntryImports.filter(
          (specifier) => !/^\.\/vad-assets-[\w-]+\.js$/.test(specifier),
        ),
      ).toEqual([]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 30_000);
}
