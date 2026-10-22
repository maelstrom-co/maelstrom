import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { load } from 'js-yaml';
import { CANONICAL_VOICE_DOCUMENTS, createSkillsBundle } from './bundle';
import { installSkillsBundle, removeSkillsBundle } from './lifecycle';

const skillsRoot = resolve(import.meta.dir, '../../skills');
const docsRoot = resolve(skillsRoot, '../../../docs');
const expectedLeads = [
  'maelstrom',
  'maelstrom-debugging',
  'maelstrom-observability',
  'maelstrom-project-onboarding',
  'maelstrom-react-migration',
  'maelstrom-state-sync',
  'maelstrom-vessel-modeling',
  'maelstrom-voice-integration',
];
const expectedProcedures = expectedLeads.filter((name) => name !== 'maelstrom');
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
  test('voice downloads preserve contributor rules without private decision records', async () => {
    const archive = await generatedBundle();
    expect(
      Object.keys(archive).filter((path) => path.includes('/docs/adr/')),
    ).toEqual([]);
    const voice = new TextDecoder().decode(
      archive[`${canonicalBundleRoot}/realtime-voice-architecture.md`],
    );
    expect(voice).toContain('TurnModeEvent');
    expect(voice).toContain('non-root entry point');
    expect(voice).toContain('noRestrictedImports');
  });

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
      expect(directoryName).toMatch(/^maelstrom(?:-[a-z]+(?:-[a-z]+)*)?$/);
      expect(typeof metadata.description).toBe('string');
      expect((metadata.description as string).length).toBeGreaterThan(80);
      expect(metadata.license).toBe('MIT');
      expect(metadata.metadata).toEqual({
        author: 'Maelstrom',
        version: expect.stringMatching(
          /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
        ),
      });
    }

    const readme = await readFile(join(skillsRoot, 'README.md'), 'utf8');
    const linkedLeads = [
      ...readme.matchAll(/\]\((maelstrom-[a-z-]+\/SKILL\.md)\)/g),
    ]
      .map((match) => match[1].replace('/SKILL.md', ''))
      .sort();
    expect(linkedLeads).toEqual(expectedProcedures);
    expect(readme).toContain('maelstrom/SKILL.md');
    expect(readme).toContain('exactly one procedure');
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

  test('build bundle preserves source content while localizing shared reference paths', async () => {
    const archive = await generatedBundle();
    const sourceFiles = await markdownFiles(skillsRoot);
    const expectedPaths = new Set<string>();

    for (const file of sourceFiles) {
      const archivePath = `apps/docs/skills/${relative(skillsRoot, file)
        .split(sep)
        .join('/')}`;
      expectedPaths.add(archivePath);
      const source = await readFile(file, 'utf8');
      expect(Buffer.from(archive[archivePath]).toString('utf8')).toBe(
        file.endsWith(`${sep}SKILL.md`)
          ? source.replaceAll('../references/', 'references/')
          : source,
      );
    }

    for (const sourcePath of CANONICAL_VOICE_DOCUMENTS) {
      const archivePath = `${canonicalBundleRoot}/${sourcePath}`;
      expectedPaths.add(archivePath);
      expect(Buffer.from(archive[archivePath])).toEqual(
        await readFile(join(docsRoot, sourcePath)),
      );
    }

    for (const path of Object.keys(archive)) {
      if (expectedPaths.has(path)) continue;
      const match = path.match(
        /^apps\/docs\/skills\/([^/]+)\/references\/(.+)$/,
      );
      expect(match).not.toBeNull();
      if (!match) throw new Error(`Unexpected bundle entry: ${path}`);
      expect(expectedProcedures).toContain(match[1]);
      expect(archive[path]).toEqual(
        archive[`apps/docs/skills/references/${match[2]}`],
      );
      expectedPaths.add(path);
    }
    expect(Object.keys(archive).sort()).toEqual([...expectedPaths].sort());
  });

  test('SDK guide inventory covers every publishable package and matches shipped artifacts', async () => {
    const readme = await readFile(join(skillsRoot, 'README.md'), 'utf8');
    const inventory = new Map(
      [
        ...readme.matchAll(
          /\| `(@maelstrom-co\/[^`]+)` \| (Shipped|Not shipped) \|/g,
        ),
      ].map((match) => [match[1], match[2]]),
    );
    const visited: string[] = [];
    const packagesRoot = resolve(import.meta.dir, '../../../../packages');
    const packageDirectories = (
      await readdir(packagesRoot, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const packageDirectory of packageDirectories) {
      const packageRoot = join(packagesRoot, packageDirectory);
      if (!existsSync(join(packageRoot, 'package.json'))) continue;
      const manifest = JSON.parse(
        await readFile(join(packageRoot, 'package.json'), 'utf8'),
      ) as {
        name: string;
        version: string;
        private?: boolean;
        files?: string[];
      };
      if (manifest.private) continue;
      visited.push(manifest.name);
      const shipsGuide = manifest.files?.includes('skills') ?? false;
      expect(inventory.get(manifest.name)).toBe(
        shipsGuide ? 'Shipped' : 'Not shipped',
      );
      expect(existsSync(join(packageRoot, 'skills'))).toBe(shipsGuide);
      if (!shipsGuide) continue;
      const guideDirectory = `maelstrom-${manifest.name.replace('@maelstrom-co/', '')}-sdk`;
      const guideSource = await readFile(
        join(packageRoot, 'skills', guideDirectory, 'SKILL.md'),
        'utf8',
      );
      const guide = parseFrontmatter(guideSource, guideDirectory);
      expect(guide.name).toBe(guideDirectory);
      expect(guide.metadata).toMatchObject({ sdkPackage: manifest.name });
      expect(guide.metadata).not.toHaveProperty('sdkVersion');
      expect(guideSource).toContain(
        'package.json` version as the version authority',
      );
    }
    expect([...inventory.keys()].sort()).toEqual(visited.sort());
  });

  test('empty project install, update, and removal manage only the consumer artifact', async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), 'maelstrom-skill-consumer-'),
    );
    const skillRoot = join(projectRoot, '.agents/skills');
    try {
      const original = await createSkillsBundle(skillsRoot, docsRoot);
      await installSkillsBundle(original, projectRoot);
      const entryPath = join(skillRoot, 'maelstrom/SKILL.md');
      const onboardingPath = join(
        skillRoot,
        'maelstrom-project-onboarding/SKILL.md',
      );
      expect(await readFile(entryPath, 'utf8')).toContain('installed package');
      expect(await readFile(onboardingPath, 'utf8')).toContain('Inspect first');
      expect(
        await readFile(
          join(
            skillRoot,
            'references/canonical-voice/docs/realtime-voice-architecture.md',
          ),
          'utf8',
        ),
      ).toContain('speech-native');

      const unrelated = join(skillRoot, 'unrelated/SKILL.md');
      await mkdir(dirname(unrelated), { recursive: true });
      await writeFile(unrelated, 'user-owned skill');
      const updatedArchive = unzipSync(original);
      updatedArchive['apps/docs/skills/maelstrom/SKILL.md'] =
        new TextEncoder().encode('updated entry skill');
      await installSkillsBundle(zipSync(updatedArchive), projectRoot);
      expect(await readFile(entryPath, 'utf8')).toBe('updated entry skill');
      expect(await readFile(unrelated, 'utf8')).toBe('user-owned skill');

      await removeSkillsBundle(projectRoot);
      await expect(readFile(entryPath, 'utf8')).rejects.toThrow();
      expect(await readFile(unrelated, 'utf8')).toBe('user-owned skill');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
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
      (file) =>
        file.includes('/references/') &&
        !file.startsWith('apps/docs/skills/references/') &&
        file.endsWith('.md'),
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references)
      expect(usedTargets.has(reference)).toBe(true);
  });

  test.each(
    expectedProcedures,
  )('%s retains its guidance when an installer copies only that skill directory', async (name) => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), 'maelstrom-individual-skill-'),
    );
    const installedRoot = join(projectRoot, '.agents/skills', name);
    try {
      const archive = await generatedBundle();
      const prefix = `apps/docs/skills/${name}/`;
      for (const [path, contents] of Object.entries(archive)) {
        if (!path.startsWith(prefix)) continue;
        const destination = join(installedRoot, path.slice(prefix.length));
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, contents);
      }

      const files = await markdownFiles(installedRoot);
      expect(files.length).toBeGreaterThan(1);
      for (const file of files) {
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
          const target = match[1];
          if (/^(?:https?:|mailto:|#)/.test(target)) continue;
          const destination = resolve(dirname(file), target.split('#')[0]);
          expect(destination.startsWith(`${installedRoot}${sep}`)).toBe(true);
          expect(await readFile(destination, 'utf8')).not.toBe('');
        }
      }

      if (name === 'maelstrom-voice-integration') {
        for (const document of CANONICAL_VOICE_DOCUMENTS) {
          expect(
            await readFile(
              join(installedRoot, 'references/canonical-voice/docs', document),
            ),
          ).toEqual(await readFile(join(docsRoot, document)));
        }
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
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
    expect(docsPage).toContain('source browsing');
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

  test('voice references include both public architecture documents', async () => {
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
    for (const file of ['realtime-voice-architecture.md', 'architecture.md'])
      expect(voiceReferences.join('\n')).toContain(
        `canonical-voice/docs/${file}`,
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
      .filter((line) => line.startsWith('| ') && line.includes('/SKILL.md'));
    expect(taskRows).toHaveLength(expectedProcedures.length);
    for (const row of taskRows) {
      expect(row.match(/\]\(maelstrom-[a-z-]+\/SKILL\.md\)/g)).toHaveLength(1);
      expect(row).toMatch(/only|before|when|after|selected|for |if /i);
    }
    const skillSources = await Promise.all(
      expectedProcedures.map((name) =>
        readFile(join(skillsRoot, name, 'SKILL.md'), 'utf8'),
      ),
    );
    expect(skillSources.join('\n')).not.toMatch(
      /spawn(?:ing)? (?:sub)?agents|load all skills/i,
    );
  });

  test('representative trials distinguish routing structure from behavioral evidence', async () => {
    const trials = await readFile(join(skillsRoot, 'trials/README.md'), 'utf8');
    expect(trials).toContain('Onboarding');
    expect(trials).toContain('Migration');
    expect(trials).toContain('Debugging');
    expect(trials).toContain('not completed agent runs');
    expect(trials).toContain('Automated tests');
    expect(trials).toContain('Behavioral acceptance requires');
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
