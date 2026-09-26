import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const ARCHIVE_PREFIX = 'apps/docs/skills/';
const MANIFEST_NAME = '.maelstrom-skills.json';

function safeRelativePath(path: string): string {
  const normalized = posix.normalize(path);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(`Unsafe skill archive path: ${path}`);
  }
  return normalized;
}

async function readManifest(target: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(target, MANIFEST_NAME), 'utf8'),
    );
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('files' in parsed) ||
      !Array.isArray(parsed.files) ||
      !parsed.files.every((file) => typeof file === 'string')
    ) {
      throw new Error(`Invalid ${MANIFEST_NAME}`);
    }
    return parsed.files.map(safeRelativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Installs or updates the bundled skills under a project's .agents/skills. */
export async function installSkillsBundle(
  archiveBytes: Uint8Array,
  projectRoot: string,
): Promise<void> {
  const target = resolve(projectRoot, '.agents/skills');
  const previous = await readManifest(target);
  const archive = unzipSync(archiveBytes);
  const files = Object.entries(archive)
    .filter(([path]) => path.startsWith(ARCHIVE_PREFIX) && !path.endsWith('/'))
    .map(([archivePath, contents]) => ({
      path: safeRelativePath(archivePath.slice(ARCHIVE_PREFIX.length)),
      contents,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!files.some(({ path }) => path === 'maelstrom/SKILL.md'))
    throw new Error(
      'Skills archive does not contain the Maelstrom entry skill',
    );

  const previousSet = new Set(previous);
  for (const { path } of files) {
    const destination = join(target, path);
    if (!previousSet.has(path)) {
      try {
        await readFile(destination);
        throw new Error(`Refusing to overwrite unmanaged skill file: ${path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  const nextPaths = new Set(files.map(({ path }) => path));
  for (const stalePath of previous) {
    if (!nextPaths.has(stalePath))
      await rm(join(target, stalePath), { force: true });
  }
  for (const { path, contents } of files) {
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, MANIFEST_NAME),
    `${JSON.stringify({ files: [...nextPaths].sort() }, null, 2)}\n`,
  );
}

/** Removes only files recorded as managed by the Maelstrom skill installer. */
export async function removeSkillsBundle(projectRoot: string): Promise<void> {
  const target = resolve(projectRoot, '.agents/skills');
  const managedFiles = await readManifest(target);
  for (const path of managedFiles)
    await rm(join(target, path), { force: true });
  await rm(join(target, MANIFEST_NAME), { force: true });
}
