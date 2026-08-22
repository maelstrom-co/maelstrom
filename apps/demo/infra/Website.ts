import { resolve } from 'node:path';
import { workerObservability } from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';

const appRoot = resolve(import.meta.dirname, '..');

export const Website = Cloudflare.Worker('Website', {
  main: resolve(appRoot, 'src/worker/index.ts'),
  name: 'maelstrom-playground',
  domain: 'demo.maelstrom-ai.co',
  // Production serves only the custom domain; see www for the rationale.
  workersDev: false,
  compatibility: { date: '2026-07-22' },
  assets: {
    directory: resolve(appRoot, 'dist/client'),
    notFoundHandling: 'single-page-application',
    runWorkerFirst: ['/ws'],
  },
  env: {
    SESSION_DO: Cloudflare.DurableObject('SESSION_DO', {
      className: 'SessionDO',
    }),
  },
  observability: workerObservability,
}).pipe(retain(true));
