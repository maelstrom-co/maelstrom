import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  server: {
    port: 3000,
    allowedHosts: ["demos.jacarte.me"]
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
