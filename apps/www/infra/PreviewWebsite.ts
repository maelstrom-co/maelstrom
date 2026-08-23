import { resolve } from 'node:path';
import {
  ASTRO_WORKER_FLAGS,
  WORKER_COMPATIBILITY_DATE,
  workerObservabilityNoTraces,
} from '@maelstrom-co/platform-infra';
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
      date: WORKER_COMPATIBILITY_DATE,
      flags: ASTRO_WORKER_FLAGS,
    },
    env: {
      IMAGES: Cloudflare.Images.Images('IMAGES'),
    },
    observability: workerObservabilityNoTraces,
  });

export type PreviewWebsiteEnv = Cloudflare.InferEnv<
  ReturnType<typeof PreviewWebsite>
>;
