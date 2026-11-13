import { resolve } from 'node:path';

import {
  WORKER_COMPATIBILITY_DATE,
  workerObservability,
} from '@maelstrom-co/platform-infra';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';

import { workerEnv } from './workerEnv.js';

const root = resolve(import.meta.dirname, '..');

export const websiteProps = {
  main: resolve(root, 'src/worker/index.ts'),
  compatibility: { date: WORKER_COMPATIBILITY_DATE, flags: ['nodejs_compat'] },
  assets: {
    directory: resolve(root, 'dist/client'),
    notFoundHandling: 'single-page-application' as const,
    runWorkerFirst: ['/api/*'],
  },
  observability: workerObservability,
};

export const Website = Cloudflare.Worker('Website', {
  ...websiteProps,
  name: 'maelstrom-agui',
  domain: 'agui.maelstrom-ai.co',
  workersDev: false,
  env: workerEnv(),
}).pipe(retain(true));

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
