import * as path from 'node:path';
import react from '@vitejs/plugin-react-swc';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/react',
  // Published components need a JSX runtime available in both React builds.
  oxc: { jsx: { development: false } },
  plugins: [
    react(),
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
      entry: {
        index: 'src/index.ts',
        _testing: 'src/_testing.ts',
      },
      name: '@maelstrom-co/react',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@maelstrom-co/client',
        '@tanstack/react-store',
      ],
    },
  },
}));
