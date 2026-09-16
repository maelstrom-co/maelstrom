import { defineCollection } from 'astro:content';
import { glob as globFiles, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob, type Loader } from 'astro/loaders';
import { blogSchema, blogSlug } from './lib/blog';

const base = './src/content/blog';
// Match nested files too so invalid authoring fails rather than disappearing.
const pattern = '**/*.mdx';
const delegate = glob({
  base,
  pattern,
  generateId: ({ entry }) => blogSlug(entry),
});

const loader: Loader = {
  name: 'blog-glob',
  async load(context) {
    const directory = fileURLToPath(new URL(base, context.config.root));
    async function hasEntries() {
      for await (const entry of globFiles(pattern, { cwd: directory })) {
        if ((await stat(join(directory, entry))).isFile()) return true;
      }
      return false;
    }

    if (await hasEntries()) return delegate.load(context);
    // Astro's empty-glob return skips stale deletion AND watcher registration.
    context.store.clear();
    const { watcher } = context;
    if (!watcher) return;
    watcher.add(directory);
    let loading = false;
    async function startGlob() {
      if (loading) return;
      loading = true;
      try {
        if (!(await hasEntries())) return;
        await delegate.load(context);
        watcher?.off('add', startGlob);
        watcher?.off('change', startGlob);
      } catch (error) {
        context.logger.error(String(error));
      } finally {
        loading = false;
      }
    }
    watcher.on('add', startGlob);
    watcher.on('change', startGlob);
    // Close the scan-to-listener window without installing duplicate glob handlers.
    await startGlob();
  },
};

/** Blog metadata and filename validation apply equally to builds and watched additions. */
export const collections = {
  blog: defineCollection({
    loader,
    schema: blogSchema,
  }),
};
