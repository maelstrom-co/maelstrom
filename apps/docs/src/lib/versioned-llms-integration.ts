import { existsSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { readDocsVersions } from './docs-versions-integration';
import { assertSmallDocsBudget } from './llm-docs-integration';
import {
  LLMS_FILES,
  type VersionedLlmsConfig,
  type VersionedLlmsSet,
  llmsSetSlug,
} from './versioned-llms';

const CONFIG_MODULE_ID = 'virtual:maelstrom/versioned-llms';
const GENERATOR_MODULE_ID = 'virtual:maelstrom/llms-txt-generator';
const ROOT_LLMS_PATH =
  /^\/(?:llms(?:-full|-small)?\.txt|_llms-txt\/[^/]+\.txt)$/;

/** Options for {@link versionedLlmsTxt}. */
export interface VersionedLlmsOptions extends Omit<
  VersionedLlmsConfig,
  'sets' | 'details'
> {
  /** The docs content root holding one folder per version. */
  root: string;
  /** Focused sets, each one top-level folder of a version. */
  sets: Omit<VersionedLlmsSet, 'slug'>[];
  /** The text below the description of each version's `llms.txt`. */
  details: (version: string) => string;
}

/**
 * Serve `llms.txt`, `llms-full.txt`, `llms-small.txt` and the focused sets
 * once per docs version under `/<version>/`, and make the unprefixed files
 * copies of the default version's. starlight-llms-txt still renders the
 * pages; its own root files are replaced at build end.
 */
export function versionedLlmsTxt(
  options: VersionedLlmsOptions,
): AstroIntegration {
  const generator = join(
    dirname(
      realpathSync(
        createRequire(import.meta.url).resolve('starlight-llms-txt'),
      ),
    ),
    'generator.ts',
  );
  return {
    name: 'maelstrom-versioned-llms-txt',
    hooks: {
      'astro:config:setup': ({ injectRoute, updateConfig }) => {
        injectRoute({
          pattern: '/[version]/[file].txt',
          entrypoint: new URL('./llms-routes/llms-file.ts', import.meta.url),
          prerender: true,
        });
        injectRoute({
          pattern: '/[version]/_llms-txt/[slug].txt',
          entrypoint: new URL('./llms-routes/llms-set.ts', import.meta.url),
          prerender: true,
        });
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'maelstrom-versioned-llms-txt',
                resolveId(id: string) {
                  if (id === GENERATOR_MODULE_ID) return generator;
                  return id === CONFIG_MODULE_ID
                    ? `\0${CONFIG_MODULE_ID}`
                    : undefined;
                },
                load(id: string) {
                  if (id !== `\0${CONFIG_MODULE_ID}`) return undefined;
                  const { root, details, sets, ...rest } = options;
                  const { versions } = readDocsVersions(root);
                  const config: VersionedLlmsConfig = {
                    ...rest,
                    sets: sets.map((set) => ({
                      ...set,
                      slug: llmsSetSlug(set.label),
                    })),
                    details: Object.fromEntries(
                      versions.map((version) => [version, details(version)]),
                    ),
                  };
                  return `export default ${JSON.stringify(config)};`;
                },
              },
            ],
          },
        });
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((request, _response, next) => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          if (ROOT_LLMS_PATH.test(url.pathname)) {
            const { defaultVersion } = readDocsVersions(options.root);
            request.url = `/${defaultVersion}${url.pathname}${url.search}`;
          }
          next();
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const { versions, defaultVersion } = readDocsVersions(options.root);
        const outDir = fileURLToPath(dir);
        for (const version of versions) {
          assertSmallDocsBudget(
            await readFile(join(outDir, version, 'llms-small.txt'), 'utf8'),
          );
        }
        const source = join(outDir, defaultVersion);
        for (const file of LLMS_FILES) {
          await copyFile(
            join(source, `${file}.txt`),
            join(outDir, `${file}.txt`),
          );
        }
        const rootSets = join(outDir, '_llms-txt');
        await rm(rootSets, { recursive: true, force: true });
        if (existsSync(join(source, '_llms-txt'))) {
          await mkdir(rootSets, { recursive: true });
          for (const name of await readdir(join(source, '_llms-txt'))) {
            await copyFile(
              join(source, '_llms-txt', name),
              join(rootSets, name),
            );
          }
        }
        logger.info(
          `llms text files for ${versions.join(', ')}; unprefixed files copied from ${defaultVersion}.`,
        );
      },
    },
  };
}
