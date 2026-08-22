import { resolve } from 'node:path';
import { workerObservability } from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    main: resolve(appRoot, 'dist/server/entry.mjs'),
    bundle: false,
    assets: { directory: resolve(appRoot, 'dist/client') },
    name: `maelstrom-www-alchemy-${stage}`,
    workersDev: true,
    compatibility: {
      // Keep deployed APIs aligned with the cataloged runtime types.
      date: '2026-07-22',
      // Astro 7's Vite 8 runtime imports node:module. Without this flag,
      // workerd rejects the prerender bundle before routes are emitted.
      flags: ['nodejs_compat'],
    },
    env: {
      IMAGES: Cloudflare.Images.Images('IMAGES'),
    },
    observability: {
      ...workerObservability,
      traces: {
        enabled: false,
        headSamplingRate: 1,
        persist: true,
      },
    },
  });

export type PreviewWebsiteEnv = Cloudflare.InferEnv<
  ReturnType<typeof PreviewWebsite>
>;
