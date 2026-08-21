import { resolve } from 'node:path';
import { workerObservability } from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';

const appRoot = resolve(import.meta.dirname, '..');

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    main: resolve(appRoot, 'src/worker/index.ts'),
    name: `maelstrom-playground-alchemy-${stage}`,
    workersDev: true,
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
  });
