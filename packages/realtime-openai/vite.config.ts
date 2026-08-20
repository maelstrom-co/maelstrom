import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime-openai',
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
      },
      name: '@maelstrom-co/realtime-openai',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        '@maelstrom-co/client',
        '@maelstrom-co/protocol',
        '@maelstrom-co/realtime',
        '@maelstrom-co/realtime-protocol',
        '@maelstrom-co/realtime-protocol/openai',
        /^@maelstrom-co\/realtime-vad(?:\/|$)/,
      ],
    },
  },
}));
