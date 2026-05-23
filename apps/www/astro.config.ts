import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import tsConfigPaths from 'vite-tsconfig-paths';

// The Cloudflare adapter boots a workerd runtime that breaks `astro dev`, so we
// drop it for the dev server only. Matching the exact command position (not a
// loose argv scan) guarantees `astro build`/`preview` can never fall through to
// the static path — that would silently strip the SSR /api/waitlist endpoint
// from the production bundle and lose every signup.
const isDevServer = process.argv[2] === 'dev';
const adapter = isDevServer ? undefined : cloudflare();

export default defineConfig({
  site: 'https://maelstrom-ai.co',
  output: 'static',
  adapter,
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tsConfigPaths({ root: '../..' }), tailwindcss()],
  },
  srcDir: './src',
  outDir: './dist',
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-heading',
      weights: [400, 500, 600, 700],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-body',
      weights: [400, 500, 600],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--font-code',
      weights: [400, 500],
      fallbacks: ['monospace'],
    },
  ],
});
