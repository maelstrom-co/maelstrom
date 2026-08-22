import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/realtime-livekit-agent',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
      bundleTypes: true,
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
    rolldownOptions: {
      external: [
        /^node:/,
        /^@livekit\//,
        'livekit-server-sdk',
        /^@maelstrom-co\//,
      ],
    },
  },
}));
