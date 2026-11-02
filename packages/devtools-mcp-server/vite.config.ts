import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

const metadata = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  root: import.meta.dirname,
  define: {
    __MAELSTROM_MCP_VERSION__: JSON.stringify(metadata.version),
  },
  cacheDir: '../../node_modules/.vite/packages/devtools-mcp-server',
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
      entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [
        /^@maelstrom-co/,
        /^@modelcontextprotocol/,
        /^node:/,
        'ws',
        'zod',
      ],
    },
  },
});
