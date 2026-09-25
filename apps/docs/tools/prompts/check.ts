import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { comparePromptSets } from './compare';
import { loadPromptLibrary } from './library';

/** Checks prompt sources at exact base/head revisions and exits nonzero on violations. */
export async function checkPromptVersions(
  base: string,
  head: string,
  cwd = process.cwd(),
): Promise<void> {
  const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const temporary = await mkdtemp(join(tmpdir(), 'maelstrom-prompts-'));
  try {
    const baseDir = join(temporary, 'base');
    const headDir = join(temporary, 'head');
    await Promise.all([
      extractPromptTree(base, baseDir, repositoryRoot),
      extractPromptTree(head, headDir, repositoryRoot),
    ]);
    const [before, after] = await Promise.all([
      loadPromptLibrary(baseDir),
      loadPromptLibrary(headDir),
    ]);
    const errors = comparePromptSets(before, after);
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function extractPromptTree(
  revision: string,
  directory: string,
  cwd: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const resolved = execFileSync(
    'git',
    ['rev-parse', '--verify', `${revision}^{commit}`],
    { cwd, encoding: 'utf8' },
  ).trim();
  const listing = execFileSync(
    'git',
    [
      'ls-tree',
      '-r',
      '--name-only',
      resolved,
      '--',
      'apps/docs/prompts/library',
    ],
    { cwd, encoding: 'utf8' },
  );
  const names = listing.split('\n').filter((name) => name.endsWith('.md'));
  await Promise.all(
    names.map(async (name) => {
      const relative = name.slice('apps/docs/prompts/library/'.length);
      const path = join(directory, relative);
      await mkdir(dirname(path), { recursive: true });
      const contents = execFileSync('git', ['show', `${resolved}:${name}`], {
        cwd,
        encoding: 'utf8',
      });
      await writeFile(path, contents);
    }),
  );
}

/** Runs the prompt check CLI for a PR's immutable base and head commit SHAs. */
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 0) {
    await loadPromptLibrary(join(process.cwd(), 'prompts/library'));
    process.stdout.write('Prompt source schema check passed.\n');
    return;
  }
  const [base, head] = args;
  if (!base || !head || args.length !== 2)
    throw new Error('usage: bun run prompts:check [<base-sha> <head-sha>]');
  await checkPromptVersions(base, head);
  process.stdout.write('Prompt source schema and version check passed.\n');
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
