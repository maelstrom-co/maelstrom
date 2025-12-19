/// <reference types='vitest' />
import { defineConfig, loadEnv } from 'vite';
import dts from 'vite-plugin-dts';
import * as path from 'path';

export default defineConfig(({ mode }) => {
  // Load env from root directory
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');

  return {
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/maelstrom/server',
  define: {
    'process.env.GOOGLE_GENERATIVE_AI_API_KEY': JSON.stringify(env.GOOGLE_GENERATIVE_AI_API_KEY),
    'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
    'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
  },
  plugins: [dts({ entryRoot: 'src', tsconfigPath: path.join(__dirname, 'tsconfig.lib.json') })],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  // Configuration for building your library.
  // See: https://vitejs.dev/guide/build.html#library-mode
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      // Could also be a dictionary or array of multiple entry points.
      entry: 'src/index.ts',
      name: '@maelstrom/server',
      fileName: 'index',
      // Change this to the formats you want to support.
      // Don't forget to update your package.json as well.
      formats: ['es' as const]
    },
    rollupOptions: {
      // External packages that should not be bundled into your library.
      external: []
    },
  },
  test: {
    name: '@maelstrom/server',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    }
  },
}});
