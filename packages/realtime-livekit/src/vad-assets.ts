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
const transactionIdPattern =
  /^(?:backup|stage)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/** Matches only sibling names created by this helper for one output basename. */
function isOwnedTransactionPathName(name: string, outputName: string): boolean {
  const prefix = `.${outputName}.`;
  return (
    name.startsWith(prefix) &&
    transactionIdPattern.test(name.slice(prefix.length))
  );
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
 * touched. Existing helper-owned staging or backup siblings reject before
 * staging or destination mutation; sibling names outside this output's exact
 * helper basename, transaction kind, and UUID format are ignored. Installing
 * the validated stage is the commit point: failures before it attempt to
 * restore the prior destination, while a later backup-removal failure preserves
 * the complete new destination, leaves any remaining backup visible for
 * fail-closed recovery, and rejects. Failed pre-commit rollback steps are
 * reported with the original failure in an `AggregateError`.
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
  const staleTransactionPath = (await readdir(parentDir)).find((name) =>
    isOwnedTransactionPathName(name, outputName),
  );
  if (staleTransactionPath) {
    throw new Error(
      `Found stale browser VAD asset transaction artifact at ${join(parentDir, staleTransactionPath)}; remove it before retrying`,
    );
  }

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
    replacementInstalled = true;

    if (backupExists) {
      await removeTransactionPath(backupDir);
    }
  } catch (error) {
    if (replacementInstalled) {
      const cleanupCause =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Browser VAD assets were installed, but backup cleanup failed at ${backupDir}: ${cleanupCause}; remove the remaining backup artifact before retrying`,
        { cause: error },
      );
    }

    const cleanupErrors: unknown[] = [];

    if (backupExists) {
      try {
        await rename(backupDir, resolvedOutputDir);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
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
