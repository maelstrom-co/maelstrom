import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const vadAssetNames = [
  'silero_vad_legacy.onnx',
  'silero_vad_v5.onnx',
  'vad.worklet.bundle.min.js',
] as const;

const onnxRuntimeAssetNames = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
] as const;

const expectedAssetNames = [...vadAssetNames, ...onnxRuntimeAssetNames].sort();

/** Options for package-owned browser VAD asset deployment. */
export interface CopyLiveKitVadAssetsOptions {
  /**
   * Dedicated child directory for generated VAD assets. Relative paths are
   * resolved from the caller's current working directory. The working
   * directory, its ancestors, filesystem roots, symbolic links, and existing
   * non-directory targets are rejected.
   */
  readonly outputDir: string;
}

interface AssetSource {
  readonly directory: string;
  readonly names: readonly string[];
}

async function getExistingTargetType(
  outputDir: string,
): Promise<'directory' | 'symlink' | 'other' | 'missing'> {
  try {
    const target = await lstat(outputDir);
    if (target.isSymbolicLink()) return 'symlink';
    if (target.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function validateStagedManifest(stageDir: string): Promise<void> {
  const stagedNames = (await readdir(stageDir)).sort();
  if (
    stagedNames.length !== expectedAssetNames.length ||
    stagedNames.some((name, index) => name !== expectedAssetNames[index])
  ) {
    throw new Error(
      'Staged browser VAD assets do not match the expected manifest',
    );
  }

  await Promise.all(
    stagedNames.map(async (name) => {
      if (!(await stat(join(stageDir, name))).isFile()) {
        throw new Error(`Staged browser VAD asset is not a file: ${name}`);
      }
    }),
  );
}

async function removeTransactionPath(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    await rm(path, { recursive: true, force: true });
  }
}

function transactionPath(
  parentDir: string,
  outputName: string,
  kind: string,
): string {
  return join(parentDir, `.${outputName}.${kind}-${randomUUID()}`);
}

function errorWithCleanupFailures(
  error: unknown,
  cleanupErrors: unknown[],
): unknown {
  if (cleanupErrors.length === 0) return error;
  const message =
    error instanceof Error ? error.message : 'Browser VAD asset copy failed';
  return new AggregateError([error, ...cleanupErrors], message, {
    cause: error,
  });
}

/**
 * Copies the VAD worklet, every supported Silero model, and the matching ONNX
 * Runtime browser modules from this package's pinned dependencies.
 *
 * The destination must be a dedicated child directory because its existing
 * contents are atomically replaced. The complete manifest is copied and
 * validated in a unique sibling staging directory before the destination is
 * touched. If replacement or transaction cleanup fails, the helper attempts
 * to restore an existing destination. If rollback cleanup or restoration also
 * fails, it throws an `AggregateError` containing the original failure and the
 * rollback failures.
 *
 * @returns Copied paths relative to the resolved destination, sorted
 * lexicographically and normalized to `/` separators.
 */
export async function copyLiveKitVadAssets({
  outputDir,
}: CopyLiveKitVadAssetsOptions): Promise<readonly string[]> {
  const resolvedOutputDir = isAbsolute(outputDir)
    ? resolve(outputDir)
    : resolve(process.cwd(), outputDir);
  if (parse(resolvedOutputDir).root === resolvedOutputDir) {
    throw new Error('outputDir must not be a filesystem root');
  }
  const relativeCwd = relative(resolvedOutputDir, process.cwd());
  if (
    relativeCwd === '' ||
    (!isAbsolute(relativeCwd) &&
      relativeCwd !== '..' &&
      !relativeCwd.startsWith(`..${sep}`))
  ) {
    throw new Error('outputDir must be a dedicated child directory');
  }

  const targetType = await getExistingTargetType(resolvedOutputDir);
  if (targetType === 'symlink') {
    throw new Error('outputDir must not be a symbolic link');
  }
  if (targetType === 'other') {
    throw new Error('outputDir must be a directory');
  }

  const parentDir = dirname(resolvedOutputDir);
  const outputName = resolvedOutputDir.slice(parentDir.length + 1);
  await mkdir(parentDir, { recursive: true });

  const sources: readonly AssetSource[] = [
    {
      directory: dirname(
        fileURLToPath(import.meta.resolve('@ricky0123/vad-web')),
      ),
      names: vadAssetNames,
    },
    {
      directory: dirname(
        fileURLToPath(import.meta.resolve('onnxruntime-web/wasm')),
      ),
      names: onnxRuntimeAssetNames,
    },
  ];
  const stageDir = transactionPath(parentDir, outputName, 'stage');
  const backupDir = transactionPath(parentDir, outputName, 'backup');
  let stageExists = false;
  let backupExists = false;
  let replacementInstalled = false;

  try {
    await mkdir(stageDir);
    stageExists = true;
    await Promise.all(
      sources.flatMap(({ directory, names }) =>
        names.map((name) =>
          copyFile(join(directory, name), join(stageDir, name)),
        ),
      ),
    );
    await validateStagedManifest(stageDir);

    if (targetType === 'directory') {
      await rename(resolvedOutputDir, backupDir);
      backupExists = true;
    }
    await rename(stageDir, resolvedOutputDir);
    stageExists = false;
    replacementInstalled = true;

    if (backupExists) {
      await rm(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    const cleanupErrors: unknown[] = [];

    if (backupExists) {
      if (replacementInstalled) {
        try {
          await removeTransactionPath(resolvedOutputDir);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (!replacementInstalled || cleanupErrors.length === 0) {
        try {
          await rename(backupDir, resolvedOutputDir);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
    }

    if (stageExists) {
      try {
        await removeTransactionPath(stageDir);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }

    throw errorWithCleanupFailures(error, cleanupErrors);
  }

  return expectedAssetNames.map((name) => name.split(sep).join('/'));
}
