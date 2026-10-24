import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/maelstrom/planner-jev',
  plugins: [
    dts({
      entryRoot: 'src',
      beforeWriteFile: (filePath) =>
        filePath.endsWith('.json.d.ts') ? false : undefined,
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
        _internal: 'src/_internal.ts',
        _testing: 'src/_testing.ts',
      },
      name: '@maelstrom-co/planner-jev',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        '@maelstrom-co/engine',
        '@maelstrom-co/protocol',
        '@maelstrom-co/telemetry/usage',
        '@tanstack/ai',
        /^node:/,
        'zod',
      ],
    },
  },
});
