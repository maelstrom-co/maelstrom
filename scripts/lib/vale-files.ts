import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const requiredFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'apps/demo/README.md',
] as const;

const recursiveRoots = ['docs', 'apps/docs/src/content/docs'] as const;

const readmeRoots = ['packages', 'tools'] as const;

function toRepoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function requirePath(root: string, path: string): Promise<void> {
  try {
    await stat(join(root, path));
  } catch {
    throw new Error(`Required Vale input does not exist: ${path}`);
  }
}

async function walkMarkdown(
  root: string,
  directory: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, directory, entry.name);
    const repoPath = toRepoPath(root, path);

    if (
      entry.isDirectory() &&
      repoPath === 'apps/docs/src/content/docs/reference'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkMarkdown(root, repoPath, files);
    } else if (
      entry.isFile() &&
      ['.md', '.mdx'].includes(extname(entry.name))
    ) {
      files.push(repoPath);
    }
  }
}

export async function findValeFiles(root: string): Promise<string[]> {
  for (const file of requiredFiles) {
    await requirePath(root, file);
  }

  const files: string[] = [...requiredFiles];

  for (const directory of recursiveRoots) {
    await requirePath(root, directory);
    await walkMarkdown(root, directory, files);
  }

  for (const directory of readmeRoots) {
    const entries = await readdir(join(root, directory), {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const path = join(root, directory, entry.name, 'README.md');
      try {
        if ((await stat(path)).isFile()) files.push(toRepoPath(root, path));
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        ) {
          throw error;
        }
        // Not every package or tool needs its own README.
      }
    }
  }

  return files.sort();
}
