import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/devtools',
  resolve: { conditions: ['browser', 'development', '@maelstrom-co/source'] },
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
        'mcp-bridge': 'src/mcp-bridge.ts',
        disabled: 'src/disabled.ts',
        production: 'src/production.ts',
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [/^@maelstrom-co/, 'react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
