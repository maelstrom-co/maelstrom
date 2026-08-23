import { resolve } from 'node:path';
import {
  WORKER_COMPATIBILITY_DATE,
  workerObservability,
} from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    name: `maelstrom-docs-alchemy-${stage}`,
    workersDev: true,
    compatibility: { date: WORKER_COMPATIBILITY_DATE },
    assets: { directory: resolve(appRoot, 'dist') },
    observability: workerObservability,
  });
