import { resolve } from 'node:path';
import {
  WORKER_COMPATIBILITY_DATE,
  workerObservability,
} from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';
import { workerEnv } from './workerEnv.js';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    main: resolve(appRoot, 'src/worker/index.ts'),
    name: `maelstrom-playground-alchemy-${stage}`,
    workersDev: true,
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
    env: workerEnv(),
    observability: workerObservability,
  });
