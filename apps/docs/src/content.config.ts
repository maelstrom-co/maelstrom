import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { createPromptCollectionLoader } from '../tools/prompts/collection-loader';
import type { PromptMetadata } from '../tools/prompts/library';

type DocsCollectionConfig = Extract<
  Parameters<typeof defineCollection>[0],
  { loader: unknown }
>;

export const collections = {
  docs: defineCollection({
    loader: docsLoader() as DocsCollectionConfig['loader'],
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
