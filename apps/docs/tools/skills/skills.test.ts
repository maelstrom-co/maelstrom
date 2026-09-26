import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { load } from 'js-yaml';

const skillsRoot = resolve(import.meta.dir, '../../skills');
const expectedLeads = [
  'maelstrom-debugging',
  'maelstrom-observability',
  'maelstrom-project-onboarding',
  'maelstrom-react-migration',
  'maelstrom-state-sync',
  'maelstrom-vessel-modeling',
  'maelstrom-voice-integration',
];

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? markdownFiles(path)
        : entry.isFile() && entry.name.endsWith('.md')
          ? [path]
          : [];
    }),
  );
  return nested.flat();
}

function parseFrontmatter(
  source: string,
  file: string,
): Record<string, unknown> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const metadata: unknown = load(match[1]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error(`${file}: frontmatter must be a mapping`);
  return metadata as Record<string, unknown>;
}

describe('portable agent skill bundle', () => {
  test('has one uniquely named lead per documented task, with valid frontmatter', async () => {
    const files = await markdownFiles(skillsRoot);
    const skillFiles = files.filter((file) =>
      relative(skillsRoot, file).endsWith(`${sep}SKILL.md`),
    );
    const names = skillFiles.map((file) => relative(skillsRoot, dirname(file)));
    expect(names.sort()).toEqual(expectedLeads);

    for (const file of skillFiles) {
      const metadata = parseFrontmatter(await readFile(file, 'utf8'), file);
      const directoryName = relative(skillsRoot, dirname(file));
      expect(metadata.name).toBe(directoryName);
      expect(directoryName).toMatch(/^maelstrom-[a-z]+(?:-[a-z]+)*$/);
      expect(typeof metadata.description).toBe('string');
      expect((metadata.description as string).length).toBeGreaterThan(80);
      expect(metadata.license).toBe('MIT');
      expect(metadata.metadata).toEqual({
        author: 'Maelstrom',
        version: '1.0.0',
      });
    }

    const readme = await readFile(join(skillsRoot, 'README.md'), 'utf8');
    const linkedLeads = [
      ...readme.matchAll(/\]\((maelstrom-[a-z-]+\/SKILL\.md)\)/g),
    ]
      .map((match) => match[1].replace('/SKILL.md', ''))
      .sort();
    expect(linkedLeads).toEqual(expectedLeads);
    expect(readme).toContain('exactly one lead');
    expect(readme).toContain('entire directory tree');
    const inventory = readme.match(/```text\n([\s\S]*?)\n```/)?.[1];
    expect(inventory).toBeTruthy();
    for (const file of files) {
      const packagePath = relative(skillsRoot, file);
      const listedPath = packagePath.startsWith(`references${sep}`)
        ? packagePath.slice(`references${sep}`.length)
        : packagePath;
      expect(inventory).toContain(listedPath);
    }
  });

  test('all local Markdown links resolve inside the distributable skill root', async () => {
    const files = await markdownFiles(skillsRoot);
    const usedTargets = new Set<string>();
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        expect(target).not.toMatch(/^\//);
        const localPath = resolve(dirname(file), target.split('#')[0]);
        expect(
          localPath === skillsRoot ||
            localPath.startsWith(`${skillsRoot}${sep}`),
        ).toBe(true);
        await expect(readFile(localPath, 'utf8')).resolves.toBeTruthy();
        usedTargets.add(relative(skillsRoot, localPath));
      }
    }

    expect(usedTargets.has('README.md')).toBe(false);
    const references = files.filter((file) =>
      relative(skillsRoot, file).startsWith(`references${sep}`),
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references)
      expect(usedTargets.has(relative(skillsRoot, reference))).toBe(true);
  });

  test('docs expose the complete portable bundle from the canonical source tree', async () => {
    const docsPage = await readFile(
      resolve(import.meta.dir, '../../src/pages/agents/skills/index.astro'),
      'utf8',
    );
    const promptIndex = await readFile(
      resolve(import.meta.dir, '../../src/pages/agents/prompts/index.astro'),
      'utf8',
    );
    expect(docsPage).toContain('resolveDocsSourceRef(process.env)');
    expect(docsPage).toContain('maelstrom/archive/');
    expect(docsPage).toContain('maelstrom/tree/');
    expect(docsPage).toContain('/apps/docs/skills');
    expect(docsPage).toContain('.zip');
    expect(docsPage).toContain('complete');
    expect(docsPage).toContain('references/');
    expect(promptIndex).toContain('agents/skills/');
  });

  test('each task has one lead and supporting guidance is conditional, not an orchestration graph', async () => {
    const readme = await readFile(join(skillsRoot, 'README.md'), 'utf8');
    const taskRows = readme
      .split('\n')
      .filter((line) => line.startsWith('| ') && line.includes('maelstrom-'));
    expect(taskRows).toHaveLength(expectedLeads.length);
    for (const row of taskRows) {
      expect(row.match(/\]\(maelstrom-[a-z-]+\/SKILL\.md\)/g)).toHaveLength(1);
      expect(row).toMatch(/only|before|when|after|selected|for |if /i);
    }
    const skillSources = await Promise.all(
      expectedLeads.map((name) =>
        readFile(join(skillsRoot, name, 'SKILL.md'), 'utf8'),
      ),
    );
    expect(skillSources.join('\n')).not.toMatch(
      /spawn(?:ing)? (?:sub)?agents|load all skills/i,
    );
  });
});
