import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { installSkillsBundle, removeSkillsBundle } from './lifecycle';

const BUNDLE_URL = 'https://docs.maelstrom-ai.co/agents/skills/bundle.zip';

async function findProjectRoot(start: string): Promise<string> {
  let directory = resolve(start);
  while (true) {
    try {
      const manifest: unknown = JSON.parse(
        await readFile(resolve(directory, 'package.json'), 'utf8'),
      );
      if (manifest && typeof manifest === 'object' && 'workspaces' in manifest)
        return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const projectRoot = await findProjectRoot(process.cwd());
  if (command === 'remove') {
    await removeSkillsBundle(projectRoot);
    console.log('Removed installed Maelstrom skills.');
    return;
  }
  if (command !== 'install' && command !== 'update') {
    throw new Error('Usage: bun run skills:<install|update|remove>');
  }
  const response = await fetch(BUNDLE_URL);
  if (!response.ok)
    throw new Error(`Bundle download failed: ${response.status}`);
  await installSkillsBundle(
    new Uint8Array(await response.arrayBuffer()),
    projectRoot,
  );
  console.log(
    `Maelstrom skills ${command === 'install' ? 'installed' : 'updated'} in .agents/skills.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
