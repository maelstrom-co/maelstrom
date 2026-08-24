import { type BigIntStats, constants } from 'node:fs';
import {
  type FileHandle,
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { isAbsolute, posix, relative, resolve, win32 } from 'node:path';

import type { Connect, Plugin } from 'vite';

const VAD_WEB_PREFIX = '/vad-web/';
const VAD_WEB_OUTPUT_PREFIX = VAD_WEB_PREFIX.slice(1);
const VAD_WEB_TRANSACTION_PATH = /^\.vad-web\.(?:backup|stage)-/;
const JAVASCRIPT_CONTENT_TYPE = 'application/javascript; charset=utf-8';

type RelativePath = (from: string, to: string) => string;

interface ValidatedDirectory {
  readonly metadata: BigIntStats;
  readonly path: string;
}

interface PublicAssetReference {
  readonly fileName: string;
  readonly path: string;
}

interface ValidatedAsset extends PublicAssetReference {
  readonly directories: readonly ValidatedDirectory[];
  readonly metadata: BigIntStats;
  readonly rootRealPath: string;
}

interface VadWebDevPluginOptions {
  readonly assetDirectory: string;
}

interface BuildPublicAssetsPluginOptions {
  readonly applyToEnvironment?: Plugin['applyToEnvironment'];
  readonly beforeReadAssets?: (
    assets: readonly PublicAssetReference[],
  ) => void | Promise<void>;
  readonly build: boolean;
  readonly publicDirectory: string;
  readonly relativePath?: RelativePath;
  readonly requiredVadWebAssetNames?: readonly [string, ...string[]];
}

/** Returns whether a filesystem operation failed because its target is absent. */
function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Returns an asset name relative to its validated root, normalized for Rollup,
 * or throws when the resolved entry is the root itself or escapes that root.
 */
function assertContained(
  rootDirectory: string,
  entryPath: string,
  relativePath: RelativePath,
): string {
  const entryRelativePath = relativePath(rootDirectory, entryPath);
  if (
    !entryRelativePath ||
    entryRelativePath === '..' ||
    entryRelativePath.startsWith('../') ||
    entryRelativePath.startsWith('..\\') ||
    posix.isAbsolute(entryRelativePath) ||
    win32.isAbsolute(entryRelativePath)
  ) {
    throw new Error(`Public asset escapes its configured root: ${entryPath}`);
  }
  return entryRelativePath.replaceAll('\\', '/');
}

/** Compares the stable device and inode identity captured by `lstat`/`stat`. */
function sameIdentity(expected: BigIntStats, actual: BigIntStats): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

/** Rejects when a previously validated directory changed identity or kind. */
async function assertDirectoryUnchanged(
  directory: ValidatedDirectory,
): Promise<void> {
  const current = await lstat(directory.path, { bigint: true });
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    !sameIdentity(directory.metadata, current)
  ) {
    throw new Error(`Public asset directory changed: ${directory.path}`);
  }
}

/**
 * Reads one validated regular file without following a final symlink. The file
 * and every containing directory must retain their validation-time identities;
 * any mismatch rejects before the caller emits this or any other asset.
 */
async function readValidatedAsset(
  asset: ValidatedAsset,
  relativePath: RelativePath,
): Promise<Buffer> {
  await Promise.all(asset.directories.map(assertDirectoryUnchanged));

  let handle: FileHandle | undefined;
  try {
    handle = await open(
      asset.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedMetadata = await handle.stat({ bigint: true });
    if (
      !openedMetadata.isFile() ||
      !sameIdentity(asset.metadata, openedMetadata)
    ) {
      throw new Error(`Public asset changed after validation: ${asset.path}`);
    }

    const currentFileName = assertContained(
      asset.rootRealPath,
      asset.path,
      relativePath,
    );
    if (currentFileName !== asset.fileName) {
      throw new Error(
        `Public asset path changed after validation: ${asset.path}`,
      );
    }

    await Promise.all(asset.directories.map(assertDirectoryUnchanged));
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

/**
 * Collects one deterministic snapshot of regular files beneath a real public
 * directory. A missing root yields an empty snapshot. Unless VAD inclusion is
 * requested, the top-level `vad-web` entry is omitted by name before its kind or
 * target is inspected. Top-level VAD staging or backup debris rejects the
 * snapshot before reads or emissions; symlinks anywhere in the included tree,
 * path escapes, and unsupported entry kinds reject.
 */
async function collectPublicAssets(
  rootDirectory: string,
  relativePath: RelativePath,
  includeVadWeb: boolean,
): Promise<ValidatedAsset[]> {
  let rootMetadata: BigIntStats;
  try {
    rootMetadata = await lstat(rootDirectory, { bigint: true });
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }

  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(
      'Public asset root must be a real directory, not a symlink',
    );
  }

  const rootRealPath = await realpath(rootDirectory);
  const root: ValidatedDirectory = {
    path: rootRealPath,
    metadata: rootMetadata,
  };
  const assets: ValidatedAsset[] = [];

  /** Visits one already validated directory without following included symlinks. */
  async function visit(
    directory: string,
    directories: readonly ValidatedDirectory[],
    topLevel: boolean,
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (topLevel && entry.name === 'vad-web' && !includeVadWeb) {
        continue;
      }
      if (topLevel && VAD_WEB_TRANSACTION_PATH.test(entry.name)) {
        throw new Error(`Public asset transaction debris found: ${entry.name}`);
      }

      const entryPath = resolve(directory, entry.name);
      const entryMetadata = await lstat(entryPath, { bigint: true });
      if (entryMetadata.isSymbolicLink()) {
        throw new Error(`Public assets cannot contain symlinks: ${entryPath}`);
      }

      const entryRealPath = await realpath(entryPath);
      const fileName = assertContained(
        rootRealPath,
        entryRealPath,
        relativePath,
      );

      if (entryMetadata.isDirectory()) {
        await visit(
          entryRealPath,
          [...directories, { path: entryRealPath, metadata: entryMetadata }],
          false,
        );
      } else if (entryMetadata.isFile()) {
        assets.push({
          directories,
          fileName,
          metadata: entryMetadata,
          path: entryRealPath,
          rootRealPath,
        });
      } else {
        throw new Error(`Unsupported public asset entry: ${entryPath}`);
      }
    }
  }

  await visit(rootRealPath, [root], true);
  return assets;
}

/**
 * Ends a handled request without exposing filesystem details.
 *
 * @param res HTTP response to close.
 */
function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.end();
}

/**
 * Creates the development-only middleware that serves VAD JavaScript assets
 * before Vite's public-file transform guard. Hosted builds disable Vite's
 * public-directory handling and use a separate allowlisting plugin. Requests
 * outside the VAD prefix or for non-JavaScript assets pass through. Malformed,
 * traversing, missing, non-file, and root-escaping JavaScript requests end as
 * 404 responses without exposing filesystem details.
 *
 * @param options Options containing the generated VAD asset directory.
 * @returns A Vite development plugin.
 */
export function createVadWebDevPlugin({
  assetDirectory,
}: VadWebDevPluginOptions): Plugin {
  return {
    name: 'maelstrom-vad-web-dev',
    configureServer(server) {
      server.middlewares.use(
        async (
          req: Connect.IncomingMessage,
          res: ServerResponse,
          next: Connect.NextFunction,
        ) => {
          const rawPath = req.url?.split(/[?#]/, 1)[0];
          if (!rawPath?.startsWith(VAD_WEB_PREFIX)) {
            next();
            return;
          }

          let requestPath: string;
          try {
            requestPath = decodeURIComponent(rawPath);
          } catch {
            notFound(res);
            return;
          }

          if (
            requestPath.includes('\\') ||
            requestPath.split('/').includes('..')
          ) {
            notFound(res);
            return;
          }

          if (!/^\/vad-web\/[^/]+\.mjs$/.test(requestPath)) {
            next();
            return;
          }

          const rootDirectory = resolve(assetDirectory);
          const filePath = resolve(
            rootDirectory,
            requestPath.slice(VAD_WEB_PREFIX.length),
          );

          try {
            const [rootRealPath, fileRealPath] = await Promise.all([
              realpath(rootDirectory),
              realpath(filePath),
            ]);
            const realRelativePath = relative(rootRealPath, fileRealPath);
            if (
              !realRelativePath ||
              realRelativePath.startsWith('..') ||
              isAbsolute(realRelativePath)
            ) {
              notFound(res);
              return;
            }

            if (!(await stat(fileRealPath)).isFile()) {
              notFound(res);
              return;
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', JAVASCRIPT_CONTENT_TYPE);
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.end(await readFile(fileRealPath));
          } catch {
            notFound(res);
          }
        },
      );
    },
  };
}

/**
 * Creates a build plugin that emits validated public assets. The generated
 * top-level `vad-web` entry is excluded unless an explicit filename allowlist is
 * provided. Non-build mode and a missing public root are no-ops; an ordinary
 * local non-LiveKit production build does run this plugin. The demo's local
 * LiveKit build disables it because Vite performs its native complete
 * `publicDir` copy for that mode instead. Top-level VAD staging or backup debris
 * fails the build before reads or emissions; symlinks anywhere in the included
 * tree fail.
 * The complete included tree is validated and every selected file is read
 * before any file is emitted, so symlinks, path escapes, unsupported entries,
 * identity changes, and read failures reject the build without partial plugin
 * output. Selected files are
 * opened without following final symlinks and must retain their validated file
 * and directory identities before their bytes are read. Emitted names are
 * root-relative and normalized to forward slashes for Vite and Rollup. An
 * optional environment filter lets callers exclude the plugin before its hooks
 * run; omitting it retains Vite's default of applying the plugin to every build
 * environment, independently of the `build` no-op guard.
 *
 * @param options Explicit plugin-build enablement, public root, and optional environment, test, and relative-path seams.
 * @returns A Vite build plugin.
 */
export function createBuildPublicAssetsPlugin({
  applyToEnvironment,
  build,
  beforeReadAssets,
  publicDirectory,
  relativePath = relative,
  requiredVadWebAssetNames,
}: BuildPublicAssetsPluginOptions): Plugin {
  return {
    name: 'maelstrom-build-public-assets',
    applyToEnvironment,
    async generateBundle() {
      if (!build) {
        return;
      }

      const assets = await collectPublicAssets(
        resolve(publicDirectory),
        relativePath,
        requiredVadWebAssetNames !== undefined,
      );
      const selectedAssets = assets.filter((asset) => {
        if (!asset.fileName.startsWith(VAD_WEB_OUTPUT_PREFIX)) return true;
        return (
          requiredVadWebAssetNames?.includes(
            asset.fileName.slice(VAD_WEB_OUTPUT_PREFIX.length),
          ) ?? false
        );
      });
      for (const assetName of requiredVadWebAssetNames ?? []) {
        if (
          !selectedAssets.some(
            (asset) =>
              asset.fileName === `${VAD_WEB_OUTPUT_PREFIX}${assetName}`,
          )
        ) {
          throw new Error(
            `Required browser VAD asset is missing: ${assetName}`,
          );
        }
      }
      await beforeReadAssets?.(selectedAssets);
      const contents = await Promise.all(
        selectedAssets.map(async (asset) => ({
          fileName: asset.fileName,
          source: await readValidatedAsset(asset, relativePath),
        })),
      );

      for (const asset of contents) {
        this.emitFile({ type: 'asset', ...asset });
      }
    },
  };
}
