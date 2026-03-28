import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  root: __dirname,
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
