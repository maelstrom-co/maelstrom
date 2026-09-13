import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { blogSchema, blogSlug } from './lib/blog';

export const collections = {
  blog: defineCollection({
    loader: glob({
      base: './src/content/blog',
      // Match nested files too so invalid authoring fails rather than disappearing.
      pattern: '**/*.mdx',
      generateId: ({ entry }) => blogSlug(entry),
    }),
    schema: blogSchema,
  }),
};
