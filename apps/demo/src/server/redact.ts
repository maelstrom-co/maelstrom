// 32 is a floor, not a tuning knob: protocol ids are nanoid() — alphabet
// `A-Za-z0-9_-`, 21 chars total — so even "sk-" landing at offset 0 leaves
// only 18 trailing characters, never enough to reach 32. A real OpenAI key
// clears this with room to spare (legacy "sk-" keys are 48 chars after the
// prefix; current "sk-proj-" keys run far longer), so raising the floor
// can't cause a genuine leaked key to survive undetected.
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9_-]{32,}/g;

/**
 * Scrubs API keys out of an outbound wire string before it leaves the
 * server. Two passes, in order: the session's own key (exact match, so it
 * is removed wherever it appears, including inside a JSON-encoded error
 * payload, regardless of length), then a generic OpenAI-key-shaped pattern
 * pass that catches a *different*, full-length key leaking into a message
 * (e.g. a stale pre-rotation key baked into a cached client or SDK error).
 * The pattern's minimum run length is deliberately long enough that it can
 * never match a protocol id (nanoid, 21 chars) — see OPENAI_KEY_PATTERN.
 */
export function redactSecrets(wire: string, apiKey?: string): string {
  let result = wire;
  if (apiKey) {
    result = result.split(apiKey).join('[redacted]');
  }
  return result.replace(OPENAI_KEY_PATTERN, '[redacted]');
}
