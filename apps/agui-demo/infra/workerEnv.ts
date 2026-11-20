import * as Cloudflare from '@alchemy.run/cloudflare';

export const workerEnv = () => ({
  WORKSPACES: Cloudflare.DurableObject<object>('WORKSPACES', {
    className: 'WorkspaceDO',
  }),
});
