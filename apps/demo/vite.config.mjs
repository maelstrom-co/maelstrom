import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Load the workspace-root .env into process.env so TanStack Start server
// functions (which run in this dev-server process) can read secrets like the
// LiveKit token credentials. Vite's import.meta.env only exposes VITE_-prefixed
// vars to the client; the '' prefix here loads everything for server-side use.
const rootEnv = loadEnv('', `${rootDir}/../..`, '');
Object.assign(process.env, rootEnv);

export default defineConfig({
  root: rootDir,
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
});
