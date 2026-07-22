import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const VAD_WEB_PREFIX = '/vad-web/';
const JAVASCRIPT_CONTENT_TYPE = 'application/javascript; charset=utf-8';

/**
 * Ends a handled request without exposing filesystem details.
 *
 * @param {{ statusCode: number, end: () => void }} res HTTP response to close.
 */
function notFound(res) {
  res.statusCode = 404;
  res.end();
}

/**
 * Creates the development-only middleware that serves VAD JavaScript assets
 * before Vite's public-file transform guard. Production builds continue to
 * copy these files from `public` without using this plugin.
 *
 * @param {{ assetDirectory: string }} options Directory containing generated VAD assets.
 * @returns {{ name: string, configureServer: (server: { middlewares: { use: (middleware: Function) => void } }) => void }} A Vite development plugin.
 */
export function createVadWebDevPlugin({ assetDirectory }) {
  return {
    name: 'maelstrom-vad-web-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawPath = req.url?.split(/[?#]/, 1)[0];
        if (!rawPath?.startsWith(VAD_WEB_PREFIX)) {
          next();
          return;
        }

        let requestPath;
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
      });
    },
  };
}
