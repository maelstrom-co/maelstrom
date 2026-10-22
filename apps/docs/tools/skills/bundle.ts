import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

export const CANONICAL_VOICE_DOCUMENTS = [
  'realtime-voice-architecture.md',
  'architecture.md',
] as const;

const BUNDLE_ROOT = 'apps/docs/skills';
const SHARED_REFERENCES_ROOT = `${BUNDLE_ROOT}/references/`;
const CANONICAL_VOICE_ROOT = `${SHARED_REFERENCES_ROOT}canonical-voice/docs`;

function localizeReferences(
  skillRoot: string,
  files: Record<string, Uint8Array>,
): void {
  const destinationFor = (path: string) =>
    path.startsWith(SHARED_REFERENCES_ROOT)
      ? `${skillRoot}/references/${path.slice(SHARED_REFERENCES_ROOT.length)}`
      : path;
  const pending = [`${skillRoot}/SKILL.md`];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (!sourcePath || visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const destination = destinationFor(sourcePath);
    const source = new TextDecoder().decode(files[sourcePath]);
    const localized = source.replace(
      /\[([^\]]*)\]\(([^)]+)\)/g,
      (link: string, label: string, target: string) => {
        if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) return link;
        const fragmentIndex = target.indexOf('#');
        const targetPath =
          fragmentIndex < 0 ? target : target.slice(0, fragmentIndex);
        const fragment = fragmentIndex < 0 ? '' : target.slice(fragmentIndex);
        const dependency = posix.normalize(
          posix.join(posix.dirname(sourcePath), targetPath),
        );
        if (
          posix.isAbsolute(targetPath) ||
          (!dependency.startsWith(`${skillRoot}/`) &&
            !dependency.startsWith(SHARED_REFERENCES_ROOT))
        ) {
          throw new Error(
            `Reference escapes skill resources: ${sourcePath} -> ${target}`,
          );
        }
        if (!files[dependency]) {
          throw new Error(
            `Missing skill reference: ${sourcePath} -> ${target}`,
          );
        }
        pending.push(dependency);
        const localPath = destinationFor(dependency);
        if (
          posix.normalize(
            posix.join(posix.dirname(destination), targetPath),
          ) === localPath
        ) {
          return link;
        }
        const localTarget =
          posix.relative(posix.dirname(destination), localPath) + fragment;
        const localLabel =
          label === `\`${target}\`` ? `\`${localTarget}\`` : label;
        return `[${localLabel}](${localTarget})`;
      },
    );
    const contents = new TextEncoder().encode(localized);
    if (
      destination !== sourcePath &&
      files[destination] &&
      !Buffer.from(files[destination]).equals(contents)
    ) {
      throw new Error(`Conflicting skill reference: ${destination}`);
    }
    files[destination] = contents;
  }
}

async function addMarkdownTree(
  sourceRoot: string,
  currentDirectory: string,
  archiveRoot: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      await addMarkdownTree(sourceRoot, sourcePath, archiveRoot, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relativePath = relative(sourceRoot, sourcePath)
        .split(sep)
        .join('/');
      files[`${archiveRoot}/${relativePath}`] = await readFile(sourcePath);
    }
  }
}

/** Creates the revision-matched, portable skill archive used by the docs build. */
export async function createSkillsBundle(
  skillsRoot: string,
  docsRoot: string,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  await addMarkdownTree(skillsRoot, skillsRoot, BUNDLE_ROOT, files);
  for (const sourcePath of CANONICAL_VOICE_DOCUMENTS) {
    const archivePath = `${CANONICAL_VOICE_ROOT}/${sourcePath}`;
    files[archivePath] = await readFile(join(docsRoot, sourcePath));
  }
  for (const path of Object.keys(files)) {
    if (path.endsWith('/SKILL.md')) {
      localizeReferences(posix.dirname(path), files);
    }
  }
  return zipSync(files, { level: 6 });
}
