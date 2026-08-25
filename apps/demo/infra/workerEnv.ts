import * as Cloudflare from 'alchemy/Cloudflare';
import type { RequiredWorkerBinding } from '../src/worker-bindings.js';

const WS_RATE_LIMIT_NAMESPACE_ID = 742;

export const workerEnv = () =>
  ({
    // The Worker uses the inherited fetch surface, not SessionDO RPC methods.
    SESSION_DO: Cloudflare.DurableObject<object>('SESSION_DO', {
      className: 'SessionDO',
    }),
    WS_RATE_LIMITER: Cloudflare.RateLimit('WS_RATE_LIMITER', {
      namespaceId: WS_RATE_LIMIT_NAMESPACE_ID,
      simple: { limit: 120, period: 60 },
    }),
  }) satisfies Record<RequiredWorkerBinding, unknown>;
