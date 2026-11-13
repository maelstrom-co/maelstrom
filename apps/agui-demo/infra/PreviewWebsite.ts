import * as Cloudflare from 'alchemy/Cloudflare';

import { websiteProps } from './Website.js';
import { workerEnv } from './workerEnv.js';

export const PreviewWebsite = (stage: string) =>
  Cloudflare.Worker('Website', {
    ...websiteProps,
    name: `maelstrom-agui-alchemy-${stage}`,
    workersDev: true,
    env: workerEnv(),
  });
