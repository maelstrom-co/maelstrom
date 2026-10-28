import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const files = [
  '.gitignore',
  '.bun-version',
  '.github/workflows/ci.yml',
  '.env.example',
  'package.json.template',
  'bun.lock.template',
  'tsconfig.json.template',
  'biome.json.template',
  'index.html',
  'server.ts',
  'server.test.ts',
  'local-planner.ts',
  'planner.ts',
  'dev.ts',
  'vite.config.ts',
  'playwright.config.ts',
  'e2e/workspace.spec.ts',
  'README.md',
  'src/main.tsx',
  'src/workspace.ts',
  'src/App.tsx',
  'src/style.css',
] as const;

/** Packages only the reviewed starter sources; local credentials and build output never enter the download. */
export async function createReactStarter(
  root: string,
  licensePath: string,
): Promise<Uint8Array> {
  const entries = await Promise.all(
    files.map(
      async (name) =>
        [
          name.replace(/\.template$/, ''),
          new Uint8Array(await readFile(join(root, name))),
        ] as const,
    ),
  );
  return zipSync({
    ...Object.fromEntries(entries),
    LICENSE: new Uint8Array(await readFile(licensePath)),
  });
}
