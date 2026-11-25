import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { snapshotTarget } from '../../src/lib/docs-snapshot-target';
import {
  DEV_VERSION,
  isVersionFolder,
  sortVersions,
} from '../../src/lib/docs-versions';
export {
  snapshotTarget,
  type SnapshotTarget,
} from '../../src/lib/docs-snapshot-target';

const docsRoot = join(import.meta.dir, '../../src/content/docs');

const REFERENCE_FOLDER = 'reference';

/**
 * The newest released folder that freezes `folder`, if any. A folder older
 * than the newest release is frozen: copying today's dev docs into it would
 * replace that release's docs with newer ones.
 */
export function frozenBy(
  folder: string,
  existing: readonly string[],
): string | undefined {
  const [newest] = sortVersions(
    existing.filter((name) => name !== DEV_VERSION && isVersionFolder(name)),
  );
  if (!newest || newest === folder) return undefined;
  return sortVersions([folder, newest])[0] === newest ? newest : undefined;
}

/**
 * Remove `slug:` frontmatter, which would pin a page outside its version
 * folder.
 */
export function stripSlugFrontmatter(text: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) return text;
  const block = frontmatter[0].replace(/^slug:.*(?:\r?\n|$)/gm, '');
  return block + text.slice(frontmatter[0].length);
}

/**
 * Add `levels` extra `../` to relative MDX imports that leave the content
 * root, for pages that move `levels` folders deeper. Imports inside the
 * content root and code inside fenced blocks are left alone.
 */
export function deepenEscapingImports(
  text: string,
  file: string,
  levels: number,
): string {
  if (levels === 0) return text;
  const dir = posix.dirname(file);
  const deepen = (specifier: string) =>
    posix.normalize(posix.join(dir, specifier)).startsWith('../')
      ? '../'.repeat(levels) + specifier
      : specifier;

  let fence: { char: string; length: number } | undefined;
  let inStatement = false;
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      if (fence) {
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (close?.[1]?.[0] === fence.char && close[1].length >= fence.length) {
          fence = undefined;
        }
        return line;
      }
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open?.[1]) {
        fence = { char: open[1][0] ?? '`', length: open[1].length };
        inStatement = false;
        return line;
      }
      const starts = /^(?:import|export)\b/.test(line);
      if (!inStatement && !starts) return line;
      const rewritten = line.replace(
        /(\bfrom\s*|^import\s*)(['"])(\.\.?\/[^'"]*)\2/g,
        (_whole, lead: string, quote: string, specifier: string) =>
          `${lead}${quote}${deepen(specifier)}${quote}`,
      );
      if (/(?:\bfrom\s*|^import\s*)['"]/.test(line)) inStatement = false;
      else if (starts) {
        inStatement = /^(?:import|export)\s+(?:type\s+)?\{[^}]*$/.test(line);
      }
      return rewritten;
    })
    .join('');
}

/** Options for {@link snapshotDocs}. */
export interface SnapshotOptions {
  /** The `src/content/docs` folder that holds the version folders. */
  root?: string;
  /**
   * A git ref to take the dev docs from instead of the working tree. Refs
   * from before the versioned layout use the docs content root itself.
   */
  from?: string;
}

/** What {@link snapshotDocs} did. */
export type SnapshotResult =
  | { kind: 'prerelease'; release: string }
  | {
      kind: 'snapshot';
      release: string;
      folder: string;
      destination: string;
      replaced: boolean;
      source: string;
      fixups: { slug: number; imports: number };
      /**
       * How the folder got its API reference: frozen from the source's
       * generated pages, kept from the folder it replaced, or none.
       */
      reference: 'frozen' | 'kept' | 'none';
    };

/**
 * Copy the dev docs into the folder for `release`, replacing that folder.
 * A patch release rewrites its minor (or major) folder, which leaves git
 * clean when the docs did not change. Frozen folders are refused unless
 * the content comes from a git ref. The API reference that the docs build
 * generated into `dev/reference/` is frozen with the copy. A source without
 * one, such as a git ref, keeps the reference the folder already has.
 */
export async function snapshotDocs(
  release: string,
  options: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const root = options.root ?? docsRoot;
  const target = snapshotTarget(release);
  if (target.kind === 'prerelease') return target;

  const existing = await readdir(root);
  const frozen = frozenBy(target.folder, existing);
  if (frozen && options.from === undefined) {
    throw new Error(
      `${target.folder} is frozen because ${frozen} is newer. Fix frozen docs by hand, or regenerate the folder from its release tag with --from.`,
    );
  }

  // Beside the docs root, so the finished copy moves into place by rename.
  const scratch = await mkdtemp(join(resolve(root, '..'), '.docs-snapshot-'));
  const destination = join(root, target.folder);
  const backup = join(scratch, 'replaced');
  let restoreFailed = false;
  try {
    const source =
      options.from === undefined
        ? {
            dir: join(root, DEV_VERSION),
            levels: 0,
            label: `working tree ${DEV_VERSION}/`,
          }
        : await extractRef(root, options.from, join(scratch, 'source'));
    const staging = join(scratch, 'staging');
    await cp(source.dir, staging, { recursive: true });
    const { pages, ...fixups } = await fixupPages(staging, source.levels);
    if (pages === 0) {
      throw new Error(
        `${source.label} has no Markdown pages; ${target.folder} was left as it was.`,
      );
    }

    const reference = await freezeReference(staging, destination);
    const replaced = existing.includes(target.folder);
    await replaceFolder(staging, destination, backup).catch(async (error) => {
      // A backup still in scratch is the only copy of the previous folder.
      restoreFailed = await isDirectory(backup);
      throw error;
    });
    return {
      kind: 'snapshot',
      release: target.release,
      folder: target.folder,
      destination,
      replaced,
      source: source.label,
      fixups,
      reference,
    };
  } finally {
    if (!restoreFailed) await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Put `replacement` where `destination` is, by renames on one filesystem.
 * The previous folder waits at `backup` and returns when the swap fails, so
 * `destination` is never left partly written.
 */
export async function replaceFolder(
  replacement: string,
  destination: string,
  backup: string,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  const previous = await isDirectory(destination);
  if (previous) await move(destination, backup);
  try {
    await move(replacement, destination);
  } catch (error) {
    if (previous) {
      await move(backup, destination).catch(() => {
        throw new Error(
          `Could not restore ${destination}. Its previous content is in ${backup}.`,
          { cause: error },
        );
      });
    }
    throw error;
  }
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: { from: { type: 'string' } },
    allowPositionals: true,
  });
  if (positionals.length !== 1) {
    console.error(
      'Usage: bun run versions:snapshot <release version> [--from <git ref>]',
    );
    process.exit(1);
  }
  try {
    const result = await snapshotDocs(positionals[0] ?? '', {
      from: values.from,
    });
    if (result.kind === 'prerelease') {
      console.log(
        `${result.release} is a prerelease. Prereleases get no docs folder, so nothing changed.`,
      );
    } else {
      console.log(
        `${result.replaced ? 'Replaced' : 'Created'} ${relative(process.cwd(), result.destination)} for ${result.release} from ${result.source}.`,
      );
      console.log(
        `Fixups: slug frontmatter removed in ${result.fixups.slug} files, imports deepened in ${result.fixups.imports} files.`,
      );
      console.log(
        {
          frozen: `API reference: frozen from the generated ${DEV_VERSION}/${REFERENCE_FOLDER}/.`,
          kept: `API reference: kept the folder's existing ${REFERENCE_FOLDER}/.`,
          none: `API reference: none. Build the docs so ${DEV_VERSION}/${REFERENCE_FOLDER}/ exists, then run this again.`,
        }[result.reference],
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function extractRef(
  root: string,
  ref: string,
  into: string,
): Promise<{ dir: string; levels: number; label: string }> {
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).replace(
    /\/$/,
    '',
  );
  const commit = await git(root, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ]).catch(() => {
    throw new Error(`Unknown git ref "${ref}".`);
  });
  const versioned = `${prefix}/${DEV_VERSION}`;
  const hasVersioned = await git(root, [
    'cat-file',
    '-e',
    `${commit}:${versioned}`,
  ]).then(
    () => true,
    () => false,
  );
  const path = hasVersioned ? versioned : prefix;
  const archive = `${into}.tar`;
  // Run from the top: in a subfolder, git archive keeps only that subfolder of the tree.
  const top = resolve(root, await git(root, ['rev-parse', '--show-cdup']));
  await git(top, ['archive', '--output', archive, `${commit}:${path}`]);
  await mkdir(into, { recursive: true });
  await Bun.$`tar -xf ${archive} -C ${into}`.quiet();
  return {
    dir: into,
    levels: hasVersioned ? 0 : 1,
    label: `${ref}:${path} (${hasVersioned ? 'versioned' : 'pre-versioning'} layout)`,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await Bun.$`git ${args}`.cwd(cwd).quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString().trim();
}

// Generated pages link into dev; the frozen copy links unversioned so the
// version serving it keeps readers inside that version.
async function freezeReference(
  staging: string,
  destination: string,
): Promise<'frozen' | 'kept' | 'none'> {
  const staged = join(staging, REFERENCE_FOLDER);
  if (await isDirectory(staged)) {
    const devLink = new RegExp(`(?<=[("'])/${DEV_VERSION}/(?=[^/])`, 'g');
    for (const file of await readdir(staged, { recursive: true })) {
      if (!/\.mdx?$/.test(file)) continue;
      const path = join(staged, file);
      const text = await readFile(path, 'utf8');
      const unversioned = text.replace(devLink, '/');
      if (unversioned !== text) await writeFile(path, unversioned);
    }
    return 'frozen';
  }
  const existing = join(destination, REFERENCE_FOLDER);
  if (!(await isDirectory(existing))) return 'none';
  await cp(existing, staged, { recursive: true });
  return 'kept';
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
}

async function fixupPages(
  dir: string,
  levels: number,
): Promise<{ pages: number; slug: number; imports: number }> {
  const counts = { pages: 0, slug: 0, imports: 0 };
  for (const file of await readdir(dir, { recursive: true })) {
    if (!/\.mdx?$/.test(file)) continue;
    const path = join(dir, file);
    if (!(await stat(path)).isFile()) continue;
    counts.pages++;
    const original = await readFile(path, 'utf8');
    const withoutSlug = stripSlugFrontmatter(original);
    const fixed = deepenEscapingImports(
      withoutSlug,
      file.split(sep).join('/'),
      levels,
    );
    if (withoutSlug !== original) counts.slug++;
    if (fixed !== withoutSlug) counts.imports++;
    if (fixed !== original) await writeFile(path, fixed);
  }
  return counts;
}
