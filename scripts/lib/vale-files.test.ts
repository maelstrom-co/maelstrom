import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findValeFiles } from './vale-files.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture(files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'maelstrom-vale-files-'));
  roots.push(root);

  await Promise.all(
    files.map(async (file) => {
      const path = join(root, file);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, '# Test\n');
    }),
  );

  return root;
}

describe('findValeFiles', () => {
  it('keeps local and CI linting on the same authored documentation surface', async () => {
    const root = await fixture([
      'README.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'CODE_OF_CONDUCT.md',
      'docs/architecture.md',
      'docs/adr/0001-example.md',
      'apps/docs/src/content/docs/guide.mdx',
      'apps/docs/src/content/docs/nested/page.md',
      'apps/docs/src/content/docs/reference/generated.md',
      'apps/demo/README.md',
      'packages/alpha/README.md',
      'packages/alpha/notes.md',
      'packages/alpha/node_modules/dependency/README.md',
      'tools/plugin/README.md',
      'tools/plugin/internal.md',
    ]);

    expect(await findValeFiles(root)).toEqual([
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'README.md',
      'SECURITY.md',
      'apps/demo/README.md',
      'apps/docs/src/content/docs/guide.mdx',
      'apps/docs/src/content/docs/nested/page.md',
      'docs/adr/0001-example.md',
      'docs/architecture.md',
      'packages/alpha/README.md',
      'tools/plugin/README.md',
    ]);
  });

  it('fails instead of silently reducing coverage when a required root document disappears', async () => {
    const root = await fixture([
      'README.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'docs/architecture.md',
      'apps/docs/src/content/docs/guide.mdx',
      'apps/demo/README.md',
    ]);

    await expect(findValeFiles(root)).rejects.toThrow(
      'Required Vale input does not exist: CODE_OF_CONDUCT.md',
    );
  });
});
