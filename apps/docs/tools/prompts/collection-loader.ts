import { fileURLToPath } from 'node:url';
import type { Loader } from 'astro/loaders';
import type { PromptMetadata, PromptSource } from './library';
import { loadPromptLibrary } from './library';

const promptLibraryDirectory = fileURLToPath(
  new URL('../../prompts/library/', import.meta.url),
);

/** Creates an Astro content loader for validated canonical prompts. */
export function createPromptCollectionLoader(
  directory = promptLibraryDirectory,
): Loader {
  return {
    name: 'maelstrom-prompt-library',
    async load({ store }) {
      const prompts = await loadPromptLibrary(directory);
      store.clear();
      for (const prompt of prompts) {
        store.set({
          id: prompt.metadata.id,
          data: {
            metadata: prompt.metadata,
            body: prompt.body,
            filename: prompt.filename,
          },
        });
      }
    },
  };
}

/** Data exposed by the prompt content collection to future consumers. */
export type PromptCollectionData = Pick<PromptSource, 'body' | 'filename'> & {
  metadata: PromptMetadata;
};
