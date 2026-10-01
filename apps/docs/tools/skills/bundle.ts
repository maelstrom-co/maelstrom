import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

export const CANONICAL_VOICE_DOCUMENTS = [
  'realtime-voice-architecture.md',
  'architecture.md',
  'adr/0001-realtime-providers-come-in-two-kinds.md',
  'adr/0002-credential-custody-is-a-dependency-edge.md',
  'adr/0003-turn-taking-is-provider-neutral.md',
] as const;

const BUNDLE_ROOT = 'apps/docs/skills';
const CANONICAL_VOICE_ROOT = `${BUNDLE_ROOT}/references/canonical-voice/docs`;

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
  return zipSync(files, { level: 6 });
}
