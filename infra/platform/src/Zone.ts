import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';

/**
 * Retained production zone identity for future zone-scoped resources.
 *
 * This resource manages only the zone type, paused state, and vanity
 * nameservers. It does not manage DNS records or DNSSEC.
 */
export const ProductionZone = Cloudflare.Zone.Zone('ProductionZone', {
  name: 'maelstrom-ai.co',
  type: 'full',
  paused: false,
  vanityNameServers: [],
}).pipe(retain(true));
