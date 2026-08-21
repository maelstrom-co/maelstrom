import { resolve } from 'node:path';
import { workerObservability } from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    name: `maelstrom-docs-alchemy-${stage}`,
    workersDev: true,
    compatibility: { date: '2026-03-30' },
    assets: { directory: resolve(appRoot, 'dist') },
    observability: workerObservability,
  });
