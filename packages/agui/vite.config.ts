import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/maelstrom/agui',
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
        browser: 'src/browser.ts',
        server: 'src/server.ts',
        contract: 'src/contract.ts',
      },
      formats: ['es'],
    },
    rolldownOptions: { external: [/^@maelstrom-co\//, /^@ag-ui\//, /^zod/] },
  },
});
