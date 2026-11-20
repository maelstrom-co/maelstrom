import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import {
  DEV_VERSION,
  type DocsVersions,
  bareTarget,
  docsEntryId,
  isVersionFolder,
  pickDefaultVersion,
  sortVersions,
  splitVersion,
} from './docs-versions';
import { markdownPath } from './markdown-path';

const VIRTUAL_MODULE_ID = 'virtual:maelstrom/docs-versions';
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;
const SAFE_REST = /^[a-z0-9][a-z0-9._/-]*$/i;

/** Read the version folders under the docs content root. */
export function readDocsVersions(
  root: string,
  env: Record<string, string | undefined> = process.env,
): DocsVersions {
  const versions = sortVersions(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isVersionFolder(entry.name))
      .map((entry) => entry.name),
  );
  if (!versions.includes(DEV_VERSION)) {
    throw new Error(`${join(root, DEV_VERSION)} is missing.`);
  }
  return {
    versions,
    defaultVersion: pickDefaultVersion(versions, env.DOCS_DEFAULT_VERSION),
    pages: Object.fromEntries(
      versions.map((version) => [version, listPages(join(root, version))]),
    ),
  };
}

/** Whether a version folder holds the page for a version-relative slug. */
export function hasVersionPage(
  root: string,
  version: string,
  rest: string,
): boolean {
  if (!rest || !SAFE_REST.test(rest) || rest.split('/').includes('..')) {
    return false;
  }
  const base = join(root, version, rest);
  return ['.md', '.mdx', `${sep}index.md`, `${sep}index.mdx`].some((suffix) =>
    existsSync(base + suffix),
  );
}

/** The static page that sends an unversioned URL to its versioned page. */
export function redirectPage(target: string, site: URL): string {
  const href = JSON.stringify(target);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting to ${target}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${new URL(target, site).href}">
<script>location.replace(${href} + location.search + location.hash)</script>
<meta http-equiv="refresh" content="0;url=${target}">
</head>
<body><a href="${target}">Redirecting to ${target}</a></body>
</html>
`;
}

/**
 * Serve docs versions from `src/content/docs/<version>/`: expose the version
 * list to pages and send unversioned URLs to the default version.
 */
export function docsVersions(root: string): AstroIntegration {
  let site: URL;
  return {
    name: 'maelstrom-docs-versions',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'maelstrom-docs-versions',
                resolveId(id: string) {
                  return id === VIRTUAL_MODULE_ID
                    ? RESOLVED_VIRTUAL_MODULE_ID
                    : undefined;
                },
                // Read on load, after starlight-typedoc has written dev/reference.
                load(id: string) {
                  if (id !== RESOLVED_VIRTUAL_MODULE_ID) return undefined;
                  return `export default ${JSON.stringify(readDocsVersions(root))};`;
                },
              },
            ],
          },
        });
      },
      'astro:config:done': ({ config }) => {
        site = new URL(config.site ?? 'http://localhost');
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((request, response, next) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return next();
          }
          const url = new URL(request.url ?? '/', 'http://localhost');
          const markdown = url.pathname.endsWith('.md');
          const rest = (
            markdown ? url.pathname.slice(0, -3) : url.pathname
          ).replace(/^\/+|\/+$/g, '');
          if (!rest || !isPageRest(rest)) return next();
          const { versions, defaultVersion } = readDocsVersions(root);
          if (splitVersion(rest, versions)) return next();
          const target = bareTarget(rest, versions, defaultVersion, (v, r) =>
            hasVersionPage(root, v, r),
          );
          if (!target) return next();
          response.statusCode = 302;
          response.setHeader(
            'Location',
            `${markdown ? markdownPath(target) : target}${url.search}`,
          );
          response.end();
        });
      },
      'astro:build:done': async ({ dir, pages, logger }) => {
        const { versions, defaultVersion } = readDocsVersions(root);
        const built = new Map<string, Set<string>>(
          versions.map((version) => [version, new Set<string>()]),
        );
        for (const { pathname } of pages) {
          const located = splitVersion(pathname, versions);
          if (located?.rest && isPageRest(located.rest)) {
            built.get(located.version)?.add(located.rest);
          }
        }
        const rests = new Set([...built.values()].flatMap((set) => [...set]));
        const outDir = fileURLToPath(dir);
        let count = 0;
        let markdownCount = 0;
        for (const rest of rests) {
          const destination = join(outDir, rest, 'index.html');
          if (existsSync(destination)) continue;
          const target = bareTarget(
            rest,
            versions,
            defaultVersion,
            (version, candidate) => built.get(version)?.has(candidate) ?? false,
          );
          if (!target) continue;
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, redirectPage(target, site));
          count++;
          // Machine readers need content rather than an HTML redirect.
          const markdownSource = join(outDir, markdownPath(target));
          const markdownCopy = join(outDir, markdownPath(`/${rest}/`));
          if (existsSync(markdownSource) && !existsSync(markdownCopy)) {
            await copyFile(markdownSource, markdownCopy);
            markdownCount++;
          }
        }
        logger.info(
          `Docs versions: ${versions.join(', ')}; default ${defaultVersion}. Wrote ${count} unversioned redirects and ${markdownCount} unversioned Markdown copies.`,
        );
      },
    },
  };
}

// Pages have no extension in their last segment; endpoints like llms.txt do.
function isPageRest(rest: string): boolean {
  return !(rest.split('/').at(-1) ?? '').includes('.');
}

function listPages(directory: string): string[] {
  const pages: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (/\.mdx?$/.test(entry.name) && !entry.name.startsWith('_')) {
        const slug = docsEntryId(
          relative(directory, path).split(sep).join('/'),
        );
        if (slug && slug !== 'index') pages.push(slug);
      }
    }
  };
  visit(directory);
  return pages.sort();
}
