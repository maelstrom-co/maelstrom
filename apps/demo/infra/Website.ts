import { resolve } from 'node:path';
import {
  WORKER_COMPATIBILITY_DATE,
  workerObservability,
} from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';

const appRoot = resolve(import.meta.dirname, '..');

export const Website = Cloudflare.Worker('Website', {
  main: resolve(appRoot, 'src/worker/index.ts'),
  name: 'maelstrom-playground',
  domain: 'demo.maelstrom-ai.co',
  // Production serves only the custom domain; see www for the rationale.
  workersDev: false,
  compatibility: {
    date: WORKER_COMPATIBILITY_DATE,
  },
  assets: {
    directory: resolve(appRoot, 'dist/client'),
    notFoundHandling: 'single-page-application',
    // Hosted token minting and greeting TTS are browser-direct, so only the
    // WebSocket route needs the Worker ahead of static assets.
    runWorkerFirst: ['/ws'],
  },
  env: {
    // The Worker uses the inherited fetch surface, not SessionDO RPC methods.
    SESSION_DO: Cloudflare.DurableObject<object>('SESSION_DO', {
      className: 'SessionDO',
    }),
  },
  observability: workerObservability,
}).pipe(retain(true));

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
