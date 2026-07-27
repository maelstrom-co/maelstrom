import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(rootDir, '../..');

export default defineConfig(({ mode }) => {
  // Server routes (e.g. api/realtime-token.ts) read process.env.* directly.
  // Vite's own env loading only exposes VITE_-prefixed vars to
  // import.meta.env, so mirror every var from the workspace root .env into
  // process.env too, without clobbering anything already set in the shell.
  const rootEnv = loadEnv(mode, workspaceRoot, '');
  for (const [key, value] of Object.entries(rootEnv)) {
    process.env[key] ??= value;
  }

  return {
    root: rootDir,
    envDir: workspaceRoot,
    server: {
      port: 3000,
    },
    // Workspace packages' `exports` maps put source behind a
    // "@maelstrom-co/source" custom condition (dist/ is otherwise the
    // default), same condition tsconfig.base.json's `customConditions`
    // already resolves for typecheck — without it here, dev/build/test all
    // bundle each package's built dist instead of its current source. SSR
    // has its own resolver in Vite, so it needs the condition set
    // separately. Vite 7 replaces (not merges) these arrays, so Vite's own
    // default conditions are spelled out here rather than dropped.
    resolve: {
      conditions: [
        'module',
        'browser',
        'development|production',
        '@maelstrom-co/source',
      ],
    },
    ssr: {
      resolve: {
        conditions: [
          'module',
          'node',
          'development|production',
          '@maelstrom-co/source',
        ],
      },
    },
    plugins: [
      tsConfigPaths({
        root: '../..',
      }),
      tailwindcss(),
      tanstackStart(),
      // React's vite plugin must come after start's vite plugin
      react(),
    ],
  };
});
