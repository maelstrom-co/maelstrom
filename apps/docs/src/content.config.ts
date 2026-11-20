import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

import { createPromptCollectionLoader } from '../tools/prompts/collection-loader';
import type { PromptMetadata } from '../tools/prompts/library';
import { docsEntryId } from './lib/docs-versions';

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
