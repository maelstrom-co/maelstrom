/** Canonical HTTPS origin for the production website and confirmation links. */
export const WAITLIST_ORIGIN = 'https://maelstrom-ai.co';

/** Hostnames accepted by the production widget and server-side verification. */
export const WAITLIST_PRODUCTION_HOSTNAMES = [
  'maelstrom-ai.co',
  'www.maelstrom-ai.co',
] as const;

/** Verified subdomain used for transactional waitlist email. */
export const WAITLIST_SENDING_DOMAIN = 'notifications.maelstrom-ai.co';

/** Sender identity authorized by the waitlist sending subdomain. */
export const WAITLIST_SENDER_ADDRESS = 'waitlist@notifications.maelstrom-ai.co';

/** Permanent community invitation used by the confirmation result and email. */
export const WAITLIST_DISCORD_INVITE_URL = 'https://discord.gg/XAjJqrF2u3';

/** Action required from waitlist Turnstile tokens in production. */
export const WAITLIST_TURNSTILE_ACTION = 'turnstile-spin-v1';

/** Cloudflare's public always-pass visible-widget key for non-production use. */
export const CLOUDFLARE_TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

/** Return whether a hostname is authorized for the production waitlist. */
export function isWaitlistProductionHostname(hostname: string): boolean {
  return WAITLIST_PRODUCTION_HOSTNAMES.some(
    (candidate) => candidate === hostname,
  );
}
