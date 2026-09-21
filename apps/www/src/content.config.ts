import { defineCollection } from 'astro:content';
import { glob as globFiles, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'astro/loaders';
import { blogSchema, blogSlug } from './lib/blog';
import { blogLoader } from './lib/blog-loader';

const base = './src/content/blog';
// Match nested files too so invalid authoring fails rather than disappearing.
const pattern = '**/*.mdx';
const delegate = glob({
  base,
  pattern,
  generateId: ({ entry }) => blogSlug(entry),
});

const loader = blogLoader(
  delegate,
  (context) => fileURLToPath(new URL(base, context.config.root)),
  async (directory) => {
    for await (const entry of globFiles(pattern, { cwd: directory })) {
      const info = await stat(join(directory, entry)).catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (info?.isFile()) return true;
    }
    return false;
  },
);

/** Blog metadata and filename validation apply equally to builds and watched additions. */
export const collections = {
  blog: defineCollection({
    loader,
    schema: blogSchema,
  }),
};
