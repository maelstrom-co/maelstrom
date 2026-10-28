import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPublicDistributions } from './distribution';

const [destinationArgument, revision] = process.argv.slice(2);
if (!destinationArgument || !revision)
  throw new Error(
    'Usage: bun tools/skills/export-distributions.ts <empty-output-directory> <source-commit-sha>',
  );
const destination = resolve(destinationArgument);
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length)
  throw new Error('The output directory must be empty');
const distributions = await createPublicDistributions(
  resolve(import.meta.dir, '../../../..'),
  revision,
);
for (const [name, files] of Object.entries(distributions)) {
  for (const [path, bytes] of Object.entries(files)) {
    const target = resolve(destination, name, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
}
console.log(`Exported starter and skills repositories to ${destination}`);
