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
