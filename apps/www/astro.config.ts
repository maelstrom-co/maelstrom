import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import tsConfigPaths from 'vite-tsconfig-paths';
import { productionUrl } from './src/lib/blog';

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
  // The site does not use Astro sessions. Avoid provisioning an orphaned KV
  // namespace that prevents a deleted PR Worker from being deployed again.
  session: {
    driver: { entrypoint: 'unstorage/drivers/null' },
  },
  // Pinned to Astro 6's behaviour. Astro 7 defaults this to 'jsx', which deletes
  // any whitespace run containing a newline instead of collapsing it to one
  // space — so a source line that *begins* with an inline tag silently ships
  // `Maelstromorchestrates`. It saved 0.38% gzipped here, which does not pay for
  // a class of invisible bug in a site that is entirely hand-authored .astro.
  compressHTML: true,
  adapter,
  integrations: [
    react(),
    mdx(),
    sitemap({
      serialize(item) {
        const url = new URL(item.url);
        if (url.pathname === '/blog' || url.pathname.startsWith('/blog/')) {
          url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
          item.url = productionUrl(url.pathname);
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tsConfigPaths({ root: '../..' }), tailwindcss()],
  },
  srcDir: './src',
  outDir: './dist',
  fonts: [
    // A single Inter face serves both body and headings — global.css points
    // --font-sans and --font-display at this one variable, so it's one Google
    // fetch with the union of weights (was two overlapping Inter entries).
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-heading',
      weights: [400, 500, 600, 700],
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
