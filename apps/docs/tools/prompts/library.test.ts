import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPromptVersions } from './check';
import { comparePromptSets } from './compare';
import {
  loadPromptLibrary,
  parsePromptSource,
  sdkVersionMatches,
} from './library';

const roots: string[] = [];
const source = (id = 'sample', version = '1.0.0', body = 'Prompt body.\n') =>
  `---\nid: ${id}\nprompt_version: ${version}\ncompatibility:\n  sdk:\n    "@maelstrom-co/react": ">=1.0.0 <2.0.0"\n---\n${body}`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prompt-library-test-'));
  roots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function commitLibrary(
  root: string,
  files: Record<string, string>,
): Promise<string> {
  const library = join(root, 'apps/docs/prompts/library');
  await rm(library, { recursive: true, force: true });
  await mkdir(library, { recursive: true });
  if (!(await Bun.file(join(root, 'README')).exists()))
    await writeFile(join(root, 'README'), 'fixture\n');
  for (const [name, text] of Object.entries(files))
    await writeFile(join(library, name), text);
  git(root, 'add', '-A');
  git(
    root,
    '-c',
    'user.name=Prompt Test',
    '-c',
    'user.email=prompt-test@example.invalid',
    'commit',
    '-m',
    'snapshot',
  );
  return git(root, 'rev-parse', 'HEAD');
}

describe('canonical prompt source', () => {
  test('loads the app-owned canonical sources with their stable IDs', async () => {
    const prompts = await loadPromptLibrary(
      join(import.meta.dir, '../../prompts/library'),
    );
    expect(prompts.map(({ metadata }) => metadata.id).sort()).toEqual([
      'maelstrom-debugging',
      'maelstrom-project-onboarding',
      'maelstrom-react-conversion',
      'maelstrom-react-inventory',
      'maelstrom-vessel-modeling',
    ]);
  });

  test('separates valid metadata, preserves the body, and provides a trailing newline', () => {
    const prompt = parsePromptSource(
      source('sample', '1.0.0', 'Body\n\nSecond paragraph.'),
    );
    expect(prompt.metadata.id).toBe('sample');
    expect(prompt.body).toBe('Body\n\nSecond paragraph.\n');
  });

  test('rejects missing, unknown, malformed, duplicate, and wrongly typed metadata', () => {
    const invalid = [
      'id: sample\n',
      source().replace('id: sample\n', 'id: sample\nextra: true\n'),
      source().replace('id: sample\n', 'id: [broken\n'),
      source().replace('id: sample\n', 'id: other\nid: sample\n'),
      source().replace('prompt_version: 1.0.0', 'prompt_version: 1'),
    ];
    for (const text of invalid) expect(() => parsePromptSource(text)).toThrow();
  });

  test('rejects prerelease versions, malformed SDK ranges, and empty SDK mappings', () => {
    expect(() => parsePromptSource(source('sample', '1.0.0-rc.1'))).toThrow();
    expect(() =>
      parsePromptSource(source().replace('>=1.0.0 <2.0.0', 'nope')),
    ).toThrow();
    expect(() =>
      parsePromptSource(
        source().replace('    "@maelstrom-co/react": ">=1.0.0 <2.0.0"\n', ''),
      ),
    ).toThrow();
  });

  test('rejects duplicate stable IDs across filenames', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'first.md'), source());
    await writeFile(join(directory, 'second.md'), source());
    await expect(loadPromptLibrary(directory)).rejects.toThrow(
      'duplicate prompt id',
    );
  });

  test('SDK prereleases require explicit inclusion in a range', () => {
    expect(sdkVersionMatches('1.2.3-rc.1', '>=1.2.3-rc.0 <1.2.3')).toBe(true);
    expect(sdkVersionMatches('1.2.3-rc.1', '>=1.2.3 <2.0.0')).toBe(false);
    expect(sdkVersionMatches('not-semver', '*')).toBe(false);
  });

  test('compares by stable ID: rename unchanged is allowed, body change at same version is not', () => {
    const before = parsePromptSource(source());
    const renamed = { ...before, filename: 'renamed.md' };
    expect(comparePromptSets([before], [renamed])).toEqual([]);
    expect(
      comparePromptSets(
        [before],
        [
          {
            ...parsePromptSource(source()),
            metadata: {
              ...before.metadata,
              compatibility: { sdk: { '@maelstrom-co/react': '>=2.0.0' } },
            },
          },
        ],
      ),
    ).toEqual([]);
    expect(
      comparePromptSets(
        [before],
        [parsePromptSource(source('sample', '1.0.1', 'Changed body\n'))],
      ),
    ).toEqual([]);
    expect(
      comparePromptSets(
        [before],
        [parsePromptSource(source('sample', '1.0.0', 'Changed\n'))],
      ),
    ).toContain('sample: body changed without a higher prompt_version');
    expect(
      comparePromptSets(
        [before],
        [parsePromptSource(source('sample', '0.9.0', before.body))],
      ),
    ).toContain('sample: prompt_version decreased');
  });

  test('rejects new IDs above initial version and removed IDs', () => {
    expect(
      comparePromptSets([], [parsePromptSource(source('new-prompt', '1.1.0'))]),
    ).toContain('new-prompt: new prompts must start at 1.0.0');
    expect(comparePromptSets([parsePromptSource(source())], [])).toContain(
      'removed prompt ID sample',
    );
  });

  test('checks exact git revisions and distinguishes a readable empty baseline', async () => {
    const root = await temporaryDirectory();
    git(root, 'init', '-q');
    const base = await commitLibrary(root, {});
    const head = await commitLibrary(root, { 'renamed.md': source() });
    await checkPromptVersions(base, head, root);
    const cli = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, 'check.ts'), base, head],
      { cwd: root, stderr: 'pipe', stdout: 'pipe' },
    );
    expect(cli.exitCode, cli.stderr.toString()).toBe(0);
    expect(cli.stdout.toString()).toContain(
      'Prompt source schema and version check passed',
    );
    await expect(
      checkPromptVersions('missing-revision', head, root),
    ).rejects.toThrow();
  });

  test('git revision comparison rejects same-version content edits and accepts ID rename', async () => {
    const root = await temporaryDirectory();
    git(root, 'init', '-q');
    const base = await commitLibrary(root, { 'old-name.md': source() });
    const unchangedRename = await commitLibrary(root, {
      'renamed.md': source(),
    });
    await expect(
      checkPromptVersions(base, unchangedRename, root),
    ).resolves.toBeUndefined();
    const changed = await commitLibrary(root, {
      'renamed.md': source('sample', '1.0.0', 'Different body\n'),
    });
    await expect(checkPromptVersions(base, changed, root)).rejects.toThrow(
      'body changed without a higher',
    );
  });
});
