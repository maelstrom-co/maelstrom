import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  server: {
    port: 3000,
  },
  plugins: [
    tsConfigPaths({
      root: '../..',
    }),
    tanstackStart(),
    // React's vite plugin must come after start's vite plugin
    react(),
  ],
});
