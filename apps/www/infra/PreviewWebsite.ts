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
      date: '2026-07-22',
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
