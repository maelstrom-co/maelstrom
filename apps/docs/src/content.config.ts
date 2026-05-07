import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

type DocsCollectionConfig = Extract<
  Parameters<typeof defineCollection>[0],
  { loader: unknown }
>;

export const collections = {
  docs: defineCollection({
    loader: docsLoader() as DocsCollectionConfig['loader'],
    schema: docsSchema(),
  }),
};
