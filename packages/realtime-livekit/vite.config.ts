import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime-livekit',
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
      name: '@maelstrom-co/realtime-livekit',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        /^node:/,
        '@maelstrom-co/client',
        '@maelstrom-co/protocol',
        '@maelstrom-co/realtime',
        '@maelstrom-co/realtime-protocol',
        '@maelstrom-co/realtime-protocol/livekit',
        '@maelstrom-co/realtime-vad',
        'livekit-client',
        'zod',
      ],
    },
  },
}));
