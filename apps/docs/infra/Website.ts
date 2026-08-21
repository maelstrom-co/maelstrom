import { resolve } from 'node:path';
import { workerObservability } from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';

const appRoot = resolve(import.meta.dirname, '..');

export const Website = Cloudflare.Worker('Website', {
  name: 'docs',
  domain: 'docs.maelstrom-ai.co',
  compatibility: { date: '2026-03-30' },
  assets: { directory: resolve(appRoot, 'dist') },
  observability: workerObservability,
}).pipe(retain(true));
