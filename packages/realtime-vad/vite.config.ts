import { chmodSync } from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => {
  let cliArtifactPath: string;

  return {
    root: __dirname,
    cacheDir: '../../node_modules/.vite/packages/realtime-vad',
    plugins: [
      dts({
        entryRoot: 'src',
        tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
      }),
      {
        name: 'executable-vad-assets-cli',
        configResolved(config) {
          cliArtifactPath = path.resolve(
            config.root,
            config.build.outDir,
            'bin/maelstrom-vad-assets.js',
          );
        },
        closeBundle() {
          chmodSync(cliArtifactPath, 0o755);
        },
      },
    ],
    build: {
      outDir: './dist',
      emptyOutDir: true,
      lib: {
        entry: {
          index: 'src/index.ts',
          'vad-assets': 'src/vad-assets.ts',
          'bin/maelstrom-vad-assets': 'src/bin/maelstrom-vad-assets.ts',
        },
        name: '@maelstrom-co/realtime-vad',
        formats: ['es' as const],
      },
      rolldownOptions: {
        // '@ricky0123/vad-web' is only ever reached through the dynamic
        // `import()` in browser-vad.ts. Keeping it external leaves that
        // import()'s code-splitting decision to the consumer's bundler
        // instead of inlining the ONNX Runtime weight into this package's
        // own dist output.
        external: [
          /^node:/,
          /^@ricky0123\/vad-web(?:\/|$)/,
          /^onnxruntime-web(?:\/|$)/,
        ],
      },
    },
  };
});
