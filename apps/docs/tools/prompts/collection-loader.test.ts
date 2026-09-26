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
  const renderedBodies = new Map<string, string>();
  const renderedEntries = new Map<
    string,
    { html: string; metadata: { headings: unknown[] } }
  >();
  const markdownInputs: string[] = [];
  const store = {
    clear: () => entries.clear(),
    set: ({
      id,
      data,
      body,
      rendered,
    }: {
      id: string;
      data: PromptCollectionData;
      body?: string;
      rendered?: { html: string; metadata: { headings: unknown[] } };
    }) => {
      entries.set(id, data);
      if (body) renderedBodies.set(id, body);
      if (rendered) renderedEntries.set(id, rendered);
    },
  };
  const loader = createPromptCollectionLoader(directory);
  await loader.load({
    store,
    renderMarkdown: async (body: string) => {
      markdownInputs.push(body);
      return {
        html: '<h2>Rendered Markdown</h2>',
        metadata: { headings: [] },
      };
    },
  } as LoaderContext);
  return { entries, renderedBodies, renderedEntries, markdownInputs };
}

const validSource = (id = 'sample', body = 'Body.\n') =>
  `---\nid: ${id}\nprompt_version: 1.0.0\ncompatibility:\n  sdk:\n    "@maelstrom-co/react": ">=1.0.0 <2.0.0"\n---\n${body}`;

describe('prompt content collection loader', () => {
  test('loads app-owned canonical sources into separate metadata and exact body fields', async () => {
    const [actual, loaded] = await Promise.all([
      loadPromptLibrary(join(import.meta.dir, '../../prompts/library')),
      loadCollection(),
    ]);

    expect(loaded.entries.size).toBe(actual.length);
    for (const prompt of actual) {
      expect(loaded.entries.get(prompt.metadata.id)).toEqual({
        metadata: prompt.metadata,
        body: prompt.body,
        filename: prompt.filename,
      });
      expect(loaded.renderedBodies.get(prompt.metadata.id)).toBe(prompt.body);
      expect(loaded.renderedEntries.get(prompt.metadata.id)).toEqual({
        html: '<h2>Rendered Markdown</h2>',
        metadata: { headings: [] },
      });
      expect(loaded.markdownInputs).toContain(prompt.body);
    }
  });

  test('preserves Markdown fences, entities, Unicode, and the body newline', async () => {
    const directory = await temporaryDirectory();
    const body = '```tsx\nconst label = "café 🧭 &amp;";\n```';
    await writeFile(join(directory, 'sample.md'), validSource('sample', body));

    const loaded = await loadCollection(directory);
    expect(loaded.entries.get('sample')?.body).toBe(`${body}\n`);
    expect(loaded.renderedBodies.get('sample')).toBe(`${body}\n`);
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
