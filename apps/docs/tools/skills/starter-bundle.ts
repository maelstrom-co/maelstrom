import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const files = [
  '.gitignore',
  'package.json.template',
  'tsconfig.json.template',
  'index.html',
  'server.ts',
  'README.md',
  'src/main.tsx',
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
