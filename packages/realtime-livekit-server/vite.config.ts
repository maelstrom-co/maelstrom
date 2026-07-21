import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
    rollupOptions: {
      external: [
        /^node:/,
        '@maelstrom-co/protocol',
        '@maelstrom-co/realtime',
        '@maelstrom-co/realtime-livekit',
        '@maelstrom-co/realtime-livekit/protocol',
        'livekit-server-sdk',
        'zod',
      ],
    },
  },
}));
