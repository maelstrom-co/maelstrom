import * as Cloudflare from 'alchemy/Cloudflare';

export const workerEnv = () => ({
  WORKSPACES: Cloudflare.DurableObject<object>('WORKSPACES', {
    className: 'WorkspaceDO',
  }),
});
