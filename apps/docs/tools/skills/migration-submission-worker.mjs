import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = (data) => createHash('sha256').update(data).digest('hex');
const sources = {};
let bytes = 0;
let files = 0;
async function visit(directory, prefix) {
  if (!(await lstat(directory)).isDirectory())
    throw new Error('Invalid source root');
  for (const entry of (await readdir(directory)).sort()) {
    const path = join(directory, entry);
    const name = `${prefix}${entry}`;
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Invalid source link');
    if (info.isDirectory()) await visit(path, `${name}/`);
    else if (info.isFile()) {
      bytes += info.size;
      files++;
      if (info.size > 128_000_000 || bytes > 1_000_000_000 || files > 50_000)
        throw new Error('Source size limit');
      sources[name] = digest(await readFile(path));
    } else throw new Error('Invalid source entry');
  }
}
try {
  const path = 'migration-attempt.json';
  if (!(await lstat(path)).isFile()) throw new Error('Invalid attempt');
  const attempt = JSON.parse(await readFile(path, 'utf8'));
  if (
    attempt.version !== 1 ||
    typeof attempt.id !== 'string' ||
    !/^[\w-]{8,128}$/.test(attempt.id)
  )
    throw new Error('Invalid attempt');
  await visit('src', 'src/');
  const ordered = Object.fromEntries(
    Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  console.log(
    JSON.stringify({
      type: 'maelstrom_migration_submission',
      version: 1,
      attemptId: attempt.id,
      sourceHash: digest(JSON.stringify(ordered)),
    }),
  );
} catch {
  console.error('Source receipt failed');
  process.exitCode = 1;
}
