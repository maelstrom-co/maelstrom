import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import tsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  site: 'https://maelstrom-ai.co',
  output: 'static',
  adapter: cloudflare(),
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tsConfigPaths({ root: '../..' }), tailwindcss()],
  },
  srcDir: './src',
  outDir: './dist',
  fonts: [
    {
      provider: fontProviders.fontshare(),
      name: 'Clash Display',
      cssVariable: '--font-heading',
      weights: [500, 600, 700],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.fontshare(),
      name: 'General Sans',
      cssVariable: '--font-body',
      weights: [400, 500, 600],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-code',
      weights: [400, 500],
      fallbacks: ['monospace'],
    },
  ],
});
