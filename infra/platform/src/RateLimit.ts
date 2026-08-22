import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';
import {
  PRODUCTION_RATE_LIMIT,
  PRODUCTION_RATE_LIMIT_RULES,
} from './RateLimitContract.js';

export const ProductionRateLimit = (zone: Cloudflare.Zone.Zone) =>
  Cloudflare.Ruleset.Ruleset(PRODUCTION_RATE_LIMIT.logicalId, {
    zone,
    name: PRODUCTION_RATE_LIMIT.name,
    description: PRODUCTION_RATE_LIMIT.description,
    phase: PRODUCTION_RATE_LIMIT.phase,
    rules: PRODUCTION_RATE_LIMIT_RULES.map((rule) => ({
      ...rule,
      ratelimit: {
        ...rule.ratelimit,
        characteristics: [...rule.ratelimit.characteristics],
      },
    })),
  }).pipe(retain(true));
