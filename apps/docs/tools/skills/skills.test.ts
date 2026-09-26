import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { load } from 'js-yaml';
import { CANONICAL_VOICE_DOCUMENTS, createSkillsBundle } from './bundle';

const skillsRoot = resolve(import.meta.dir, '../../skills');
const docsRoot = resolve(skillsRoot, '../../../docs');
const expectedLeads = [
  'maelstrom-debugging',
  'maelstrom-observability',
  'maelstrom-project-onboarding',
  'maelstrom-react-migration',
  'maelstrom-state-sync',
  'maelstrom-vessel-modeling',
  'maelstrom-voice-integration',
];
const canonicalBundleRoot = 'apps/docs/skills/references/canonical-voice/docs';

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

async function generatedBundle(): Promise<Record<string, Uint8Array>> {
  return unzipSync(await createSkillsBundle(skillsRoot, docsRoot));
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
    expect(readme).toContain('complete tree');
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

  test('build bundle exactly matches skill and canonical architecture sources', async () => {
    const archive = await generatedBundle();
    const sourceFiles = await markdownFiles(skillsRoot);
    const expectedPaths = new Set<string>();

    for (const file of sourceFiles) {
      const archivePath = `apps/docs/skills/${relative(skillsRoot, file)
        .split(sep)
        .join('/')}`;
      expectedPaths.add(archivePath);
      expect(Buffer.from(archive[archivePath])).toEqual(await readFile(file));
    }

    for (const sourcePath of CANONICAL_VOICE_DOCUMENTS) {
      const archivePath = `${canonicalBundleRoot}/${sourcePath}`;
      expectedPaths.add(archivePath);
      expect(Buffer.from(archive[archivePath])).toEqual(
        await readFile(join(docsRoot, sourcePath)),
      );
    }

    expect(Object.keys(archive).sort()).toEqual([...expectedPaths].sort());
  });

  test('every relative Markdown link in the extracted bundle resolves within the bundle', async () => {
    const archive = await generatedBundle();
    const paths = Object.keys(archive);
    const usedTargets = new Set<string>();
    for (const archivePath of paths.filter((file) => file.endsWith('.md'))) {
      const source = Buffer.from(archive[archivePath]).toString('utf8');
      for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        expect(target).not.toMatch(/^\//);
        const localPath = posix.normalize(
          posix.join(posix.dirname(archivePath), target.split('#')[0]),
        );
        expect(localPath.startsWith('apps/docs/skills/')).toBe(true);
        expect(archive[localPath]).toBeDefined();
        usedTargets.add(localPath);
      }
    }

    expect(usedTargets.has('apps/docs/skills/README.md')).toBe(false);
    const references = paths.filter(
      (file) => file.includes('/references/') && file.endsWith('.md'),
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references)
      expect(usedTargets.has(reference)).toBe(true);
  });

  test('docs page links to the build-generated bundle and labels GitHub links as browsing only', async () => {
    const docsPage = await readFile(
      resolve(import.meta.dir, '../../src/pages/agents/skills/index.astro'),
      'utf8',
    );
    const promptIndex = await readFile(
      resolve(import.meta.dir, '../../src/pages/agents/prompts/index.astro'),
      'utf8',
    );
    expect(docsPage).toContain('/agents/skills/bundle.zip');
    expect(docsPage).toContain('download="maelstrom-agent-skills.zip"');
    expect(docsPage).toContain('sourceTree');
    expect(docsPage).toContain('sourceFile');
    expect(docsPage).toContain('browsing only');
    expect(docsPage).not.toContain('sourceArchive');
    expect(docsPage).not.toContain('<main');
    expect(promptIndex).toContain('agents/skills/');
  });

  test('voice instructions separate browser keys from owning server and worker credentials', async () => {
    const prompt = await readFile(
      resolve(
        import.meta.dir,
        '../../prompts/library/maelstrom-voice-integration.md',
      ),
      'utf8',
    );
    const skill = await readFile(
      join(skillsRoot, 'maelstrom-voice-integration/SKILL.md'),
      'utf8',
    );
    expect(prompt).toContain(
      'long-lived provider keys stay out of browser code',
    );
    expect(prompt).toContain('the worker uses LiveKit,');
    expect(prompt).toContain('Vessel/Chart structure');
    expect(prompt).toContain('canonical-voice/docs/');
    expect(skill).toMatch(
      /Never put long-lived provider keys in browser code/i,
    );
    expect(skill).toContain(
      'LiveKit cascade worker uses LiveKit, Deepgram, and Cartesia credentials',
    );
    expect(skill).toContain('Keep Vessel/Chart structure out of every worker');
  });

  test('voice references route to the canonical docs origin and bundled ADR evidence', async () => {
    for (const file of [
      'browser-react.md',
      'connectors-and-auth.md',
      'provider-deployment.md',
      'vessel-modeling.md',
      'voice-lifecycle-and-turn-taking.md',
    ]) {
      const source = await readFile(
        join(skillsRoot, 'references', file),
        'utf8',
      );
      expect(source).not.toContain('https://maelstrom.co/');
    }
    const voiceReferences = await Promise.all(
      ['provider-deployment.md', 'voice-lifecycle-and-turn-taking.md'].map(
        (file) => readFile(join(skillsRoot, 'references', file), 'utf8'),
      ),
    );
    expect(voiceReferences.join('\n')).toContain(
      'https://docs.maelstrom-ai.co/understanding/voice-architecture/',
    );
    for (const adr of CANONICAL_VOICE_DOCUMENTS.filter((file) =>
      file.startsWith('adr/'),
    ))
      expect(voiceReferences.join('\n')).toContain(
        `canonical-voice/docs/${adr}`,
      );
    expect(voiceReferences.join('\n')).toContain('version-specific only when');
  });

  test('migration conditionally reads Actions/idempotence guidance and README selection agrees', async () => {
    const migration = await readFile(
      join(skillsRoot, 'maelstrom-react-migration/SKILL.md'),
      'utf8',
    );
    const readme = await readFile(join(skillsRoot, 'README.md'), 'utf8');
    expect(migration).toContain(
      'Before exposing a side-effecting or retry-sensitive Action',
    );
    expect(migration).toContain('../references/actions-and-idempotence.md');
    expect(
      readme
        .split('\n')
        .find((row) => row.includes('maelstrom-react-migration/SKILL.md')),
    ).toContain(
      'Actions/idempotence before exposing side effects or retry-sensitive operations',
    );
  });

  test('all task rows select one lead and skills do not spawn an orchestration graph', async () => {
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

  test('each newly referenced prompt has a collapsed source disclosure on its guide', async () => {
    const cases = [
      [
        'src/content/docs/guides/client/custom-connectors.mdx',
        'maelstrom-connector-auth',
      ],
      [
        'src/content/docs/guides/react/variants-and-actions.mdx',
        'maelstrom-state-sync',
      ],
      [
        'src/content/docs/guides/react/error-handling.mdx',
        'maelstrom-observability',
      ],
      [
        'src/content/docs/guides/voice/overview.mdx',
        'maelstrom-voice-integration',
      ],
    ] as const;
    for (const [file, id] of cases) {
      const source = await readFile(
        resolve(import.meta.dir, '../../', file),
        'utf8',
      );
      expect(source).toContain(`(/agents/prompts/${id}/)`);
      expect(source).toContain(`<PromptDisclosure id="${id}" />`);
      expect(source).toContain('import PromptDisclosure from');
    }
  });
});
