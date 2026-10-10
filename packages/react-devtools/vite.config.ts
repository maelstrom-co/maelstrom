import * as path from 'node:path';
import react from '@vitejs/plugin-react';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/react-devtools',
  resolve: { conditions: ['browser', 'development', '@maelstrom-co/source'] },
  plugins: [
    react(),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        disabled: 'src/disabled.ts',
        production: 'src/production.ts',
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [/^@maelstrom-co/, 'react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
