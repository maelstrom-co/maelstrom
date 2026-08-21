import * as Cloudflare from 'alchemy/Cloudflare';

export const workerEnv = () => ({
  // The Worker uses the inherited fetch surface, not SessionDO RPC methods.
  SESSION_DO: Cloudflare.DurableObject<object>('SESSION_DO', {
    className: 'SessionDO',
  }),
  WS_RATE_LIMITER: Cloudflare.RateLimit('WS_RATE_LIMITER', {
    namespaceId: 742,
    simple: { limit: 120, period: 60 },
  }),
});
