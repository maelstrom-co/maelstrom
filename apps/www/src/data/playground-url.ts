const PRODUCTION_PLAYGROUND_URL = 'https://demo.maelstrom-ai.co';
const INVALID_PLAYGROUND_URL_MESSAGE =
  'PUBLIC_PLAYGROUND_URL must be an absolute HTTPS URL without credentials';

/**
 * Resolves the build-time Playground destination. An absent override uses the
 * production destination except in preview, where it fails closed. A supplied
 * override must be absolute HTTPS without credentials and is returned unchanged
 * rather than normalized, preserving Wrangler paths, queries, and trailing slash.
 */
export function resolvePlaygroundUrl(
  override: string | undefined,
  cloudflareEnvironment: string | undefined,
): string {
  if (override === undefined) {
    if (cloudflareEnvironment === 'preview') {
      throw new Error(
        'PUBLIC_PLAYGROUND_URL is required when CLOUDFLARE_ENV=preview',
      );
    }
    return PRODUCTION_PLAYGROUND_URL;
  }

  if (!/^https:\/\//i.test(override) || /\s/u.test(override)) {
    throw new Error(INVALID_PLAYGROUND_URL_MESSAGE);
  }

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error(INVALID_PLAYGROUND_URL_MESSAGE);
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(INVALID_PLAYGROUND_URL_MESSAGE);
  }

  return override;
}

export const PLAYGROUND_URL = resolvePlaygroundUrl(
  process.env.PUBLIC_PLAYGROUND_URL,
  process.env.CLOUDFLARE_ENV,
);
