import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Listed explicitly rather than globbed. Only this project runs on Vitest;
    // every `packages/*` suite runs on `bun test` and imports `bun:test`, so any
    // glob over `{apps,packages,tools}/*/vite.config.*` enrolls ten projects that
    // die on `Cannot find package 'bun:test'`. A glob also cannot express the one
    // thing that decides membership — whether the config declares a `test` block.
    // Add an entry here when a project adopts Vitest.
    projects: ['apps/demo/vite.config.mjs'],
  },
});
