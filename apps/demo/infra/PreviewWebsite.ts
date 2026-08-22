import { resolve } from 'node:path';
import { workerObservability } from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    main: resolve(appRoot, 'src/worker/index.ts'),
    name: `maelstrom-playground-alchemy-${stage}`,
    workersDev: true,
    compatibility: {
      // Keep deployed APIs aligned with the cataloged runtime types.
      date: '2026-07-22',
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
  });
