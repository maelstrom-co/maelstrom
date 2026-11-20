import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  deepenEscapingImports,
  frozenBy,
  snapshotDocs,
  snapshotTarget,
  stripSlugFrontmatter,
} from './snapshot';

describe('snapshotTarget', () => {
  test.each([
    ['0.2.1', '0.2'],
    ['v0.3.0', '0.3'],
    ['0.3.1', '0.3'],
    ['0.4.0', '0.4'],
    ['0.10.2', '0.10'],
    ['1.0.0', '1'],
    ['1.4.2', '1'],
    ['v2.0.0', '2'],
    ['1.2.3+build.7', '1'],
  ])('puts %s in folder %s', (release, folder) => {
    expect(snapshotTarget(release)).toEqual({
      kind: 'folder',
      release: release.replace(/^v/, ''),
      folder,
    });
  });

  test.each(['0.3.0-rc.1', 'v1.0.0-beta.2', '2.0.0-alpha'])(
    'gives the prerelease %s no folder',
    (release) => {
      expect(snapshotTarget(release)).toEqual({
        kind: 'prerelease',
        release: release.replace(/^v/, ''),
      });
    },
  );

  test.each(['0.3', 'latest', '01.2.3', '1.2.3.4', ''])(
    'rejects %p',
    (release) => {
      expect(() => snapshotTarget(release)).toThrow(/semver release/);
    },
  );
});

describe('frozenBy', () => {
  test('a folder older than the newest release is frozen by it', () => {
    expect(frozenBy('0.2', ['dev', '0.2', '0.3'])).toBe('0.3');
    expect(frozenBy('1', ['dev', '0.9', '1', '2'])).toBe('2');
  });

  test('the newest folder, a new folder and the first folder are writable', () => {
    expect(frozenBy('0.3', ['dev', '0.2', '0.3'])).toBeUndefined();
    expect(frozenBy('0.4', ['dev', '0.2', '0.3'])).toBeUndefined();
    expect(frozenBy('1', ['dev', '0.9'])).toBeUndefined();
    expect(frozenBy('0.2', ['dev'])).toBeUndefined();
  });

  test('compares versions numerically and ignores other entries', () => {
    expect(frozenBy('0.9', ['dev', '0.10', '.DS_Store'])).toBe('0.10');
    expect(frozenBy('0.10', ['dev', '0.9', 'notes'])).toBeUndefined();
  });
});

describe('stripSlugFrontmatter', () => {
  test('removes slug from frontmatter only', () => {
    const page = '---\ntitle: Cases\nslug: evals/cases\n---\n\nslug: kept\n';
    expect(stripSlugFrontmatter(page)).toBe(
      '---\ntitle: Cases\n---\n\nslug: kept\n',
    );
  });

  test('leaves pages without frontmatter alone', () => {
    expect(stripSlugFrontmatter('slug: a\n')).toBe('slug: a\n');
  });
});

describe('deepenEscapingImports', () => {
  const page = [
    '---',
    'title: Overview',
    '---',
    "import PromptDisclosure from '../../../../components/PromptDisclosure.astro';",
    "import { Tabs } from '@astrojs/starlight/components';",
    "import Local from './local.mdx';",
    'import {',
    '  OWNERSHIP,',
    "} from '../../../../components/ownership/voice';",
    '',
    '```ts',
    "import { m } from '../../../../maelstrom';",
    '```',
    '',
  ].join('\n');

  test('adds one level to imports that leave the content root', () => {
    const fixed = deepenEscapingImports(page, 'guides/voice/overview.mdx', 1);
    expect(fixed).toContain(
      "import PromptDisclosure from '../../../../../components/PromptDisclosure.astro';",
    );
    expect(fixed).toContain(
      "} from '../../../../../components/ownership/voice';",
    );
  });

  test('keeps package, in-root and fenced imports as written', () => {
    const fixed = deepenEscapingImports(page, 'guides/voice/overview.mdx', 1);
    expect(fixed).toContain(
      "import { Tabs } from '@astrojs/starlight/components';",
    );
    expect(fixed).toContain("import Local from './local.mdx';");
    expect(fixed).toContain("import { m } from '../../../../maelstrom';");
  });

  test('changes nothing when the depth does not change', () => {
    expect(deepenEscapingImports(page, 'guides/voice/overview.mdx', 0)).toBe(
      page,
    );
  });
});

describe('snapshotDocs', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function docsRoot(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-test-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return root;
  }

  test('copies dev into a new folder and freezes its generated reference', async () => {
    const root = await docsRoot({
      'dev/guides/a.mdx': '# A\n',
      'dev/reference/api/README.md':
        '- [Api](/dev/reference/api/classes/api/)\n- [Guide](/dev/guides/a/)\n',
      '0.2/guides/a.mdx': '# Old A\n',
    });

    const result = await snapshotDocs('0.3.0', { root });

    expect(result).toMatchObject({
      kind: 'snapshot',
      folder: '0.3',
      replaced: false,
      reference: 'frozen',
    });
    expect((await readdir(join(root, '0.3'))).sort()).toEqual([
      'guides',
      'reference',
    ]);
    expect(await readFile(join(root, '0.3/guides/a.mdx'), 'utf8')).toBe(
      '# A\n',
    );
    expect(
      await readFile(join(root, '0.3/reference/api/README.md'), 'utf8'),
    ).toBe('- [Api](/reference/api/classes/api/)\n- [Guide](/dev/guides/a/)\n');
    expect(await readFile(join(root, '0.2/guides/a.mdx'), 'utf8')).toBe(
      '# Old A\n',
    );
  });

  test('keeps the folder reference when the source has none', async () => {
    const root = await docsRoot({
      'dev/guides/a.mdx': '# A\n',
      '0.3/guides/a.mdx': '# Old A\n',
      '0.3/reference/api/README.md': '# API 0.3.0\n',
    });

    const result = await snapshotDocs('0.3.1', { root });

    expect(result).toMatchObject({ folder: '0.3', reference: 'kept' });
    expect(
      await readFile(join(root, '0.3/reference/api/README.md'), 'utf8'),
    ).toBe('# API 0.3.0\n');
    expect(await readFile(join(root, '0.3/guides/a.mdx'), 'utf8')).toBe(
      '# A\n',
    );
  });

  test('a new folder without a generated reference reports none', async () => {
    const root = await docsRoot({ 'dev/guides/a.mdx': '# A\n' });

    expect(await snapshotDocs('0.3.0', { root })).toMatchObject({
      reference: 'none',
    });
    expect(await readdir(join(root, '0.3'))).toEqual(['guides']);
  });

  test('a patch release replaces its minor folder', async () => {
    const root = await docsRoot({
      'dev/guides/a.mdx': '# A\n',
      '0.3/guides/removed.mdx': '# Gone\n',
    });

    const result = await snapshotDocs('0.3.1', { root });

    expect(result).toMatchObject({ folder: '0.3', replaced: true });
    expect(await readdir(join(root, '0.3/guides'))).toEqual(['a.mdx']);
  });

  test('a prerelease writes nothing', async () => {
    const root = await docsRoot({ 'dev/guides/a.mdx': '# A\n' });

    expect(await snapshotDocs('0.3.0-rc.1', { root })).toEqual({
      kind: 'prerelease',
      release: '0.3.0-rc.1',
    });
    expect((await readdir(root)).sort()).toEqual(['dev']);
  });

  test('refuses to overwrite a frozen folder from dev', async () => {
    const root = await docsRoot({
      'dev/guides/a.mdx': '# A\n',
      '0.2/guides/a.mdx': '# Old A\n',
      '0.3/guides/a.mdx': '# A\n',
    });

    await expect(snapshotDocs('0.2.2', { root })).rejects.toThrow(
      /0\.2 is frozen because 0\.3 is newer/,
    );
    expect(await readFile(join(root, '0.2/guides/a.mdx'), 'utf8')).toBe(
      '# Old A\n',
    );
  });

  test('keeps the target folder when the source has no pages', async () => {
    const root = await docsRoot({
      'dev/.keep': '',
      '0.3/guides/a.mdx': '# A\n',
    });

    await expect(snapshotDocs('0.3.1', { root })).rejects.toThrow(
      /no Markdown pages/,
    );
    expect(await readFile(join(root, '0.3/guides/a.mdx'), 'utf8')).toBe(
      '# A\n',
    );
  });

  test('takes pre-versioning content from a git ref and moves it a folder deeper', async () => {
    const repo = await docsRoot({
      'docs/guides/a.mdx': [
        '---',
        'title: A',
        'slug: guides/a',
        '---',
        "import X from '../../components/X.astro';",
        '',
      ].join('\n'),
    });
    const git = (...args: string[]) =>
      Bun.$`git -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false -c tag.gpgsign=false -c tag.forcesignannotated=false ${args}`
        .cwd(repo)
        .quiet();
    await git('init', '--quiet');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'docs');
    await git('tag', 'v0.2.1');
    await mkdir(join(repo, 'docs/dev'), { recursive: true });
    await mkdir(join(repo, 'docs/0.2/reference/api'), { recursive: true });
    await writeFile(
      join(repo, 'docs/0.2/reference/api/README.md'),
      '# API 0.2.1\n',
    );

    const result = await snapshotDocs('0.2.1', {
      root: join(repo, 'docs'),
      from: 'v0.2.1',
    });

    expect(result).toMatchObject({
      folder: '0.2',
      fixups: { slug: 1, imports: 1 },
      reference: 'kept',
    });
    expect(
      await readFile(join(repo, 'docs/0.2/reference/api/README.md'), 'utf8'),
    ).toBe('# API 0.2.1\n');
    expect(await readFile(join(repo, 'docs/0.2/guides/a.mdx'), 'utf8')).toBe(
      [
        '---',
        'title: A',
        '---',
        "import X from '../../../components/X.astro';",
        '',
      ].join('\n'),
    );
  });
});
