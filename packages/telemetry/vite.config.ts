import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/telemetry',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        integration: 'src/integration.ts',
        usage: 'src/usage.ts',
      },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
    },
  },
});
