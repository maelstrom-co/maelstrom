import { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY } from '@maelstrom-co/platform-infra/waitlist-contract';

export { CLOUDFLARE_TURNSTILE_TEST_SITE_KEY };

const MANAGED_SITE_KEY_PATTERN = /^0x[A-Za-z0-9_-]{20,80}$/;

/**
 * Resolves a build-time site key without allowing a test or malformed key in
 * a production artifact. Preview and local builds always use Cloudflare's
 * public test widget.
 */
export function resolveTurnstileSiteKey(
  configuredSiteKey: string | undefined,
  deploymentEnvironment: string | undefined,
) {
  if (
    deploymentEnvironment === undefined ||
    deploymentEnvironment === 'preview'
  ) {
    return CLOUDFLARE_TURNSTILE_TEST_SITE_KEY;
  }
  if (deploymentEnvironment !== 'production') {
    throw new Error('PUBLIC_TURNSTILE_ENVIRONMENT is invalid');
  }

  if (!configuredSiteKey) {
    throw new Error(
      'PUBLIC_TURNSTILE_SITE_KEY is required for a production build',
    );
  }
  if (
    configuredSiteKey === CLOUDFLARE_TURNSTILE_TEST_SITE_KEY ||
    !MANAGED_SITE_KEY_PATTERN.test(configuredSiteKey)
  ) {
    throw new Error('Production requires a managed Turnstile site key');
  }
  return configuredSiteKey;
}

/** Site key embedded into the current website artifact. */
export const WAITLIST_TURNSTILE_SITE_KEY = resolveTurnstileSiteKey(
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY,
  import.meta.env.PUBLIC_TURNSTILE_ENVIRONMENT,
);
