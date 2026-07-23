import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runLiveKitAssetsCli } from './maelstrom-livekit-assets.js';

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

describe('runLiveKitAssetsCli', () => {
  test('requires exactly one output directory argument', async () => {
    const output = captureOutput();

    const exitCode = await runLiveKitAssetsCli([], output.io);

    expect(exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([
      'Usage: maelstrom-livekit-assets <outputDir>',
    ]);
  });

  test('prints only the copied-file count after success', async () => {
    const output = captureOutput();

    const exitCode = await runLiveKitAssetsCli(
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

    const exitCode = await runLiveKitAssetsCli(
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

    const exitCode = await runLiveKitAssetsCli(
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
  test('builds an executable package-manager bin artifact', () => {
    const packageRoot = resolve(import.meta.dir, '../..');
    const outputDir = mkdtempSync(join(tmpdir(), 'maelstrom-livekit-cli-'));

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

      const binPath = resolve(outputDir, 'bin/maelstrom-livekit-assets.js');
      expect(statSync(binPath).mode & 0o111).not.toBe(0);
      expect(readFileSync(binPath, 'utf8')).toStartWith(
        '#!/usr/bin/env node\n',
      );
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 15_000);
}
