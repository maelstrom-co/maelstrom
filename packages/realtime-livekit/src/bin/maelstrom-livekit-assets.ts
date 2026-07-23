#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyLiveKitVadAssets } from '../vad-assets.js';

interface CliOutput {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

type CopyAssets = typeof copyLiveKitVadAssets;

const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`,
  'gu',
);
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCodePoint(0)}-${String.fromCodePoint(31)}${String.fromCodePoint(127)}-${String.fromCodePoint(159)}]+`,
  'gu',
);

const consoleOutput: CliOutput = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

/**
 * Retains the provider or filesystem failure context while removing terminal
 * control characters and machine-specific absolute paths from CLI output.
 */
function sanitizeFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';

  return (
    error.message
      .replace(ANSI_ESCAPE_SEQUENCE, '')
      .replace(CONTROL_CHARACTERS, ' ')
      .replace(/(['"])(?:\/|[A-Za-z]:[\\/])[^'"]*\1/gu, '<path>')
      .replace(/\b[A-Za-z]:[\\/][^\s,;]+/gu, '<path>')
      .replace(/(^|[\s:(])\/[^\s,;]+/gu, '$1<path>')
      .replace(/\s+/gu, ' ')
      .trim() || 'Unknown error'
  );
}

/**
 * Runs the asset-copy CLI. Exactly one destination argument is required.
 * Success writes only the copied-file count; failure writes one concise error
 * to stderr and never reports a copied-file count. Failure context is retained,
 * but terminal control characters and machine-specific absolute paths are not.
 *
 * @returns `0` after a successful replacement, otherwise `1`.
 */
export async function runLiveKitAssetsCli(
  args: readonly string[],
  output: CliOutput = consoleOutput,
  copyAssets: CopyAssets = copyLiveKitVadAssets,
): Promise<number> {
  if (args.length !== 1) {
    output.stderr('Usage: maelstrom-livekit-assets <outputDir>');
    return 1;
  }

  try {
    const copiedPaths = await copyAssets({ outputDir: args[0] });
    output.stdout(`Copied ${copiedPaths.length} browser VAD assets.`);
    return 0;
  } catch (error) {
    output.stderr(
      `Failed to copy browser VAD assets: ${sanitizeFailureMessage(error)}`,
    );
    return 1;
  }
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runLiveKitAssetsCli(process.argv.slice(2));
}
