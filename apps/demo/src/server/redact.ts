const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9_-]{8,}/g;

/**
 * Scrubs API keys out of an outbound wire string before it leaves the
 * server. Two passes, in order: the session's own key (exact match, so it
 * is removed wherever it appears, including inside a JSON-encoded error
 * payload), then a generic OpenAI-key-shaped pattern pass that catches
 * partial/masked echoes (e.g. a provider SDK truncating the key for
 * display) that don't match the stored key byte-for-byte.
 */
export function redactSecrets(wire: string, apiKey?: string): string {
  let result = wire;
  if (apiKey) {
    result = result.split(apiKey).join('[redacted]');
  }
  return result.replace(OPENAI_KEY_PATTERN, '[redacted]');
}
