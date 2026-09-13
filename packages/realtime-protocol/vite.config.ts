import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime-protocol',
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
        openai: 'src/openai.ts',
        'openai-live': 'src/openai-live.ts',
        livekit: 'src/livekit.ts',
        'livekit-wire': 'src/livekit-wire.ts',
      },
      name: '@maelstrom-co/realtime-protocol',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: ['@maelstrom-co/protocol', 'zod'],
    },
  },
}));
