import { adopt } from 'alchemy/AdoptPolicy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { retain } from 'alchemy/RemovalPolicy';

/**
 * Retained production zone identity for future zone-scoped resources.
 *
 * `adopt(true)` is a one-time bootstrap. Remove it immediately after the first
 * successful deployment persists `ProductionZone` state. This resource manages
 * only the zone type, paused state, and vanity nameservers. It does not manage
 * DNS records or DNSSEC.
 */
export const ProductionZone = Cloudflare.Zone.Zone('ProductionZone', {
  name: 'maelstrom-ai.co',
  type: 'full',
  paused: false,
  vanityNameServers: [],
}).pipe(adopt(true), retain(true));
