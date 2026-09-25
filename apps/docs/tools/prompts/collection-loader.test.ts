import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoaderContext } from 'astro/loaders';
import {
  createPromptCollectionLoader,
  type PromptCollectionData,
} from './collection-loader';
import { loadPromptLibrary } from './library';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prompt-collection-test-'));
  roots.push(root);
  return root;
}

async function loadCollection(directory?: string) {
  const entries = new Map<string, PromptCollectionData>();
  const store = {
    clear: () => entries.clear(),
    set: ({ id, data }: { id: string; data: PromptCollectionData }) =>
      entries.set(id, data),
  };
  const loader = createPromptCollectionLoader(directory);
  await loader.load({ store } as LoaderContext);
  return entries;
}

const validSource = (id = 'sample', body = 'Body.\n') =>
  `---\nid: ${id}\nprompt_version: 1.0.0\ncompatibility:\n  sdk:\n    "@maelstrom-co/react": ">=1.0.0 <2.0.0"\n---\n${body}`;

describe('prompt content collection loader', () => {
  test('loads app-owned canonical sources into separate metadata and exact body fields', async () => {
    const [actual, loaded] = await Promise.all([
      loadPromptLibrary(join(import.meta.dir, '../../prompts/library')),
      loadCollection(),
    ]);

    expect(loaded.size).toBe(actual.length);
    for (const prompt of actual) {
      expect(loaded.get(prompt.metadata.id)).toEqual({
        metadata: prompt.metadata,
        body: prompt.body,
        filename: prompt.filename,
      });
    }
  });

  test('preserves Markdown fences, entities, Unicode, and the body newline', async () => {
    const directory = await temporaryDirectory();
    const body = '```tsx\nconst label = "café 🧭 &amp;";\n```';
    await writeFile(join(directory, 'sample.md'), validSource('sample', body));

    expect((await loadCollection(directory)).get('sample')?.body).toBe(
      `${body}\n`,
    );
  });

  test('propagates a missing prompt source directory error', async () => {
    await expect(
      loadCollection(join(await temporaryDirectory(), 'missing')),
    ).rejects.toThrow();
  });

  test('propagates invalid metadata and duplicate IDs', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'invalid.md'), 'not frontmatter\n');
    await expect(loadCollection(directory)).rejects.toThrow(
      'expected YAML frontmatter',
    );

    await rm(join(directory, 'invalid.md'));
    await writeFile(join(directory, 'first.md'), validSource());
    await writeFile(join(directory, 'second.md'), validSource());
    await expect(loadCollection(directory)).rejects.toThrow(
      'duplicate prompt id',
    );
  });

  test('propagates valid-frontmatter schema errors', async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, 'invalid.md'),
      validSource().replace(
        'prompt_version: 1.0.0',
        'prompt_version: 1.0.0-rc.1',
      ),
    );
    await expect(loadCollection(directory)).rejects.toThrow(
      'stable semantic version',
    );
  });
});
