import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

import { browserVadAssetNamesForModel } from '../../packages/realtime-vad/src/vad-asset-manifest.ts';
import { HOSTED_VAD_MODEL } from './src/lib/hosted-vad-model.ts';

import {
  createBuildPublicAssetsPlugin,
  createVadWebDevPlugin,
} from './vad-web-dev-plugin.ts';

export const hostedVadAssetNames =
  browserVadAssetNamesForModel(HOSTED_VAD_MODEL);

const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(rootDir, '../..');

/**
 * Browser key custody is mandatory for hosted builds and is the local fallback
 * when the demo server has no OpenAI key of its own.
 *
 * @param {boolean} hosted
 * @param {string | undefined} apiKey
 * @returns {'0' | '1'}
 */
export function resolveBrowserKeyMode(hosted, apiKey) {
  return hosted || !apiKey?.trim() ? '1' : '0';
}

export default defineConfig(({ command, mode }) => {
  // Server routes (e.g. api/realtime-token.ts) read process.env.* directly.
  // Vite's own env loading only exposes VITE_-prefixed vars to
  // import.meta.env, so mirror every var from the workspace root .env into
  // process.env too, without clobbering anything already set in the shell.
  const rootEnv = loadEnv(mode, workspaceRoot, '');
  for (const [key, value] of Object.entries(rootEnv)) {
    process.env[key] ??= value;
  }

  // Same VITE_HOSTED=1 switch every other hosted-mode branch in this app
  // reads (see src/lib/hosted-mode.ts's isHosted()) — this file runs in
  // Node, outside the client bundle, so it reads process.env directly
  // rather than import.meta.env. The hosted (Cloudflare) build needs a
  // prerendered SPA shell because its Worker does not run the Start request
  // handler. Self-hosted builds still emit that handler for server functions,
  // even though the demo page itself is client-rendered in both profiles.
  const hosted = process.env.VITE_HOSTED === '1';
  // Expose only the custody mode, never the key. Client code uses this to
  // switch localhost to the same browser-key paths as hosted mode when the
  // server cannot satisfy text or voice requests itself.
  process.env.VITE_BROWSER_KEY_MODE = resolveBrowserKeyMode(
    hosted,
    process.env.OPENAI_API_KEY,
  );

  // A local LiveKit production build needs the generated `public/vad-web`
  // assets, so it uses Vite's native complete public-directory copy. Other
  // production builds disable that native copy and let the allowlisting plugin
  // emit the validated public tree while intentionally excluding `vad-web`.
  const livekitBuild = command === 'build' && mode === 'livekit' && !hosted;

  return {
    root: rootDir,
    envDir: workspaceRoot,
    publicDir: 'public',
    build: {
      copyPublicDir: livekitBuild,
    },
    server: {
      port: 3000,
    },
    // Workspace packages' `exports` maps put source behind a
    // "@maelstrom-co/source" custom condition (dist/ is otherwise the
    // default), same condition tsconfig.base.json's `customConditions`
    // already resolves for typecheck — without it here, dev/build/test all
    // bundle each package's built dist instead of its current source. SSR
    // has its own resolver in Vite, so it needs the condition set
    // separately. Vite 7 replaces (not merges) these arrays, so Vite's own
    // default conditions are spelled out here rather than dropped.
    resolve: {
      conditions: [
        'module',
        'browser',
        'development|production',
        '@maelstrom-co/source',
      ],
    },
    ssr: {
      resolve: {
        conditions: [
          'module',
          'node',
          'development|production',
          '@maelstrom-co/source',
        ],
      },
    },
    plugins: [
      createBuildPublicAssetsPlugin({
        applyToEnvironment: (environment) => environment.name === 'client',
        build: command === 'build' && !livekitBuild,
        publicDirectory: join(rootDir, 'public'),
        requiredVadWebAssetNames: hosted ? hostedVadAssetNames : undefined,
      }),
      createVadWebDevPlugin({
        assetDirectory: join(rootDir, 'public', 'vad-web'),
      }),
      tsConfigPaths({
        root: '../..',
      }),
      tailwindcss(),
      tanstackStart({
        ...(hosted
          ? {
              spa: {
                enabled: true,
                // outputPath is the SPA shell's filename mask (relative to
                // the client output dir), not an output directory — '/index'
                // resolves to index.html at the root of dist/client so it
                // can be served standalone as the SPA entry point.
                prerender: {
                  enabled: true,
                  outputPath: '/index',
                  crawlLinks: true,
                  retryCount: 3,
                },
              },
            }
          : {}),
      }),
      // React's vite plugin must come after start's vite plugin
      react(),
    ],
  };
});
