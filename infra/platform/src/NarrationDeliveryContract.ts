import { PRODUCTION_RATE_LIMIT } from './RateLimitContract.js';

export const narrationDelivery = {
  stack: 'MaelstromNarrationProductionDelivery',
  fqn: 'NarrationDelivery',
  name: 'maelstrom-blog-narration-delivery',
  entrypoint: 'narration-production-delivery.run.ts',
  zoneId: PRODUCTION_RATE_LIMIT.zoneId,
  hosts: ['maelstrom-ai.co', 'www.maelstrom-ai.co'],
  path: '/_blog-narration/',
} as const;

export const narrationDeliveryRoutes = narrationDelivery.hosts.map((host) => ({
  zoneId: narrationDelivery.zoneId,
  pattern: `${host}${narrationDelivery.path}*`,
}));
