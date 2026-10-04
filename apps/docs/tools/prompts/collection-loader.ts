import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Loader, LoaderContext } from 'astro/loaders';
import type { PromptMetadata, PromptSource } from './library';
import { loadPromptLibrary } from './library';

const promptLibraryDirectory = fileURLToPath(
  new URL('../../prompts/library/', import.meta.url),
);

/** Creates an Astro content loader for validated canonical prompts. */
export function createPromptCollectionLoader(
  directory = promptLibraryDirectory,
): Loader {
  const absoluteDirectory = resolve(directory);
  let watcher: LoaderContext['watcher'];
  let refresh: (() => Promise<void>) | undefined;
  let listeners: (() => void)[] = [];
  let pendingRefresh = Promise.resolve();

  return {
    name: 'maelstrom-prompt-library',
    async load(context) {
      if (watcher && refresh && listeners.length > 0) {
        for (const remove of listeners) remove();
        listeners = [];
      }
      watcher = context.watcher;
      const sync = async () => {
        const prompts = await loadPromptLibrary(absoluteDirectory);
        const entries = await Promise.all(
          prompts.map(async (prompt) => ({
            id: prompt.metadata.id,
            data: {
              metadata: prompt.metadata,
              body: prompt.body,
              filename: prompt.filename,
            },
            body: prompt.body,
            rendered: await context.renderMarkdown(prompt.body),
          })),
        );
        context.store.clear();
        for (const entry of entries) context.store.set(entry);
      };
      await sync();

      if (!watcher) return;
      watcher.add(absoluteDirectory);
      refresh = async () => {
        try {
          await sync();
        } catch (error) {
          context.logger.error(
            `Failed to reload prompt library: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
      const onChange = (changedPath: string) => {
        if (
          dirname(resolve(changedPath)) !== absoluteDirectory ||
          !changedPath.endsWith('.md')
        ) {
          return;
        }
        pendingRefresh = pendingRefresh.then(async () => refresh?.());
        return pendingRefresh;
      };
      for (const event of ['add', 'change', 'unlink'] as const) {
        watcher.on(event, onChange);
        listeners.push(() => watcher?.off(event, onChange));
      }
    },
  };
}

/** Data exposed by the prompt content collection to future consumers. */
export type PromptCollectionData = Pick<PromptSource, 'body' | 'filename'> & {
  metadata: PromptMetadata;
};
