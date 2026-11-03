import { resolve } from 'node:path';
import * as Cloudflare from '@alchemy.run/cloudflare';
import {
  WORKER_COMPATIBILITY_DATE,
  workerObservability,
} from '@maelstrom-co/platform-infra';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    name: `maelstrom-docs-alchemy-${stage}`,
    workersDev: true,
    compatibility: { date: WORKER_COMPATIBILITY_DATE },
    assets: { directory: resolve(appRoot, 'dist') },
    observability: workerObservability,
  });
