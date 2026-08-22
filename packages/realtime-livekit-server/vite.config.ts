import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime-livekit-server',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: '@maelstrom-co/realtime-livekit-server',
      fileName: 'index',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        /^node:/,
        '@maelstrom-co/protocol',
        '@maelstrom-co/realtime-protocol',
        '@maelstrom-co/realtime-protocol/livekit',
        'livekit-server-sdk',
        'zod',
      ],
    },
  },
}));
