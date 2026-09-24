import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/maelstrom/engine',
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
    commonjsOptions: { transformMixedEsModules: true },
    lib: {
      entry: {
        index: 'src/index.ts',
        _testing: 'src/_testing.ts',
      },
      name: '@maelstrom-co/engine',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: ['@maelstrom-co/protocol', 'zod'],
    },
  },
});
