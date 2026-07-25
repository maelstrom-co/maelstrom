import { chmodSync } from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => {
  let cliArtifactPath: string;

  return {
    root: __dirname,
    cacheDir: '../../node_modules/.vite/packages/realtime-livekit',
    plugins: [
      dts({
        entryRoot: 'src',
        tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
      }),
      {
        name: 'executable-livekit-assets-cli',
        configResolved(config) {
          cliArtifactPath = path.resolve(
            config.root,
            config.build.outDir,
            'bin/maelstrom-livekit-assets.js',
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
          'bin/maelstrom-livekit-assets': 'src/bin/maelstrom-livekit-assets.ts',
        },
        name: '@maelstrom-co/realtime-livekit',
        formats: ['es' as const],
      },
      rollupOptions: {
        external: [
          /^node:/,
          /^@ricky0123\/vad-web(?:\/|$)/,
          /^onnxruntime-web(?:\/|$)/,
          '@maelstrom-co/client',
          '@maelstrom-co/protocol',
          '@maelstrom-co/realtime',
          '@maelstrom-co/realtime-protocol',
          '@maelstrom-co/realtime-protocol/livekit',
          'livekit-client',
          'zod',
        ],
      },
      name: '@maelstrom-co/realtime-livekit',
      formats: ['es' as const],
    },
    rolldownOptions: {
      external: [
        /^node:/,
        '@maelstrom-co/client',
        '@maelstrom-co/protocol',
        '@maelstrom-co/realtime',
        'livekit-client',
        'zod',
      ],
    },
  };
});
