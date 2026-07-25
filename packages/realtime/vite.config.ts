import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        google: 'src/google.ts',
      },
      name: '@maelstrom-co/realtime',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        '@maelstrom-co/client',
        '@maelstrom-co/protocol',
        '@maelstrom-co/realtime-protocol',
      ],
    },
  },
}));
