import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime-livekit-agent',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
      rollupTypes: true,
    }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    ssr: true,
    lib: {
      entry: {
        index: 'src/index.ts',
      },
      name: '@maelstrom-co/realtime-livekit-agent',
      formats: ['es' as const],
    },
    rollupOptions: {
      external: [
        /^node:/,
        /^@livekit\//,
        'livekit-server-sdk',
        /^@maelstrom-co\//,
      ],
    },
  },
}));
