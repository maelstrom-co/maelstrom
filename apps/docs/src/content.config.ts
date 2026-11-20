import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

import { createPromptCollectionLoader } from '../tools/prompts/collection-loader';
import type { PromptMetadata } from '../tools/prompts/library';

type DocsCollectionConfig = Extract<
  Parameters<typeof defineCollection>[0],
  { loader: unknown }
>;

export const collections = {
  docs: defineCollection({
    loader: docsLoader({
      generateId: ({ entry, data }) => docsEntryId(entry, data.slug),
    }) as DocsCollectionConfig['loader'],
    schema: docsSchema(),
  }),
  prompts: defineCollection({
    loader: createPromptCollectionLoader(),
    schema: z.object({
      metadata: z.custom<PromptMetadata>(),
      body: z.string(),
      filename: z.string(),
    }),
  }),
};

// github-slugger, which Astro applies to entry ids, removes these on ASCII names.
const SLUG_REMOVED = /[!-,./:-@[-^`{-~]/g;

// Astro's default entry id, minus the dev/ folder, so pages keep their routes.
function docsEntryId(entry: string, slug: unknown): string {
  if (typeof slug === 'string' && slug) return slug;
  return entry
    .replace(/^dev\//, '')
    .replace(/\.[^./]+$/, '')
    .split('/')
    .map((segment) =>
      segment.toLowerCase().replace(SLUG_REMOVED, '').replace(/ /g, '-'),
    )
    .join('/')
    .replace(/\/index$/, '');
}
