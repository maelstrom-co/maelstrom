import { consoleLogger, type Logger } from '@maelstrom-co/engine';

// 32 is a floor, not a tuning knob: protocol ids are nanoid() — alphabet
// `A-Za-z0-9_-`, 21 chars total — so even "sk-" landing at offset 0 leaves
// only 18 trailing characters, never enough to reach 32. A real OpenAI key
// clears this with room to spare (legacy "sk-" keys are 48 chars after the
// prefix; current "sk-proj-" keys run far longer), so raising the floor
// can't cause a genuine leaked key to survive undetected.
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9_-]{32,}/g;

/**
 * Scrubs API keys out of an outbound wire string before it leaves the
 * server. Callers pass an already-JSON-serialized wire string, so a key
 * containing a character JSON escapes (`"`, `\`, a newline, ...) appears in
 * that string in its escaped form, not raw — an exact-match pass against the
 * raw key alone would find zero occurrences and ship it verbatim. Passes, in
 * order: the raw key (exact match), the key's JSON-escaped form (only when
 * it differs from the raw key), then a generic OpenAI-key-shaped pattern
 * pass that catches a *different*, full-length key leaking into a message
 * (e.g. a stale pre-rotation key baked into a cached client or SDK error).
 * Between the raw and escaped passes, the key is removed wherever it
 * appears, including inside a JSON-encoded error payload, regardless of
 * length. The pattern's minimum run length is deliberately long enough that
 * it can never match a protocol id (nanoid, 21 chars) — see
 * OPENAI_KEY_PATTERN.
 */
export function redactSecrets(wire: string, apiKey?: string): string {
  let result = wire;
  if (apiKey) {
    result = result.split(apiKey).join('[redacted]');
    const escaped = JSON.stringify(apiKey).slice(1, -1);
    if (escaped !== apiKey) {
      result = result.split(escaped).join('[redacted]');
    }
  }
  return result.replace(OPENAI_KEY_PATTERN, '[redacted]');
}

/**
 * Redacts an apiKey out of an error's message so it can never reach a log
 * line or a wire error payload — key custody is a hosted-mode invariant,
 * not just a nicety. Delegates to redactSecrets (exact-match pass +
 * sk-*-shaped pattern pass) so this is the same scrub every other outbound
 * path uses, not a second hand-rolled copy of it.
 */
export function redact(err: unknown, apiKey: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(redactSecrets(message, apiKey));
}

function redactUnknown(value: unknown, apiKey: string): unknown {
  if (typeof value === 'string') return redactSecrets(value, apiKey);
  if (value instanceof Error) {
    const clone = new Error(redactSecrets(value.message, apiKey));
    clone.name = value.name;
    if (value.stack) clone.stack = redactSecrets(value.stack, apiKey);
    return clone;
  }
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value), apiKey));
  } catch {
    return '[unloggable value]';
  }
}

function redactData(
  data: Record<string, unknown> | undefined,
  apiKey: string,
): Record<string, unknown> | undefined {
  if (!data) return data;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      redactUnknown(value, apiKey),
    ]),
  );
}

/**
 * A Logger that scrubs the session's apiKey (and any sk-*-shaped string) out
 * of every argument before delegating to consoleLogger. createEngine's
 * default logger is consoleLogger, which writes provider SDK errors —
 * including OpenAI's own 401 key echo — straight to stdout; hosted mode's
 * container observability persists that. Every hosted-mode engine must be
 * built with one of these instead of the default.
 */
export function createRedactingLogger(apiKey: string): Logger {
  return {
    debug: (message, data) =>
      consoleLogger.debug(
        redactSecrets(message, apiKey),
        redactData(data, apiKey),
      ),
    info: (message, data) =>
      consoleLogger.info(
        redactSecrets(message, apiKey),
        redactData(data, apiKey),
      ),
    warn: (message, data) =>
      consoleLogger.warn(
        redactSecrets(message, apiKey),
        redactData(data, apiKey),
      ),
    error: (message, error, data) =>
      consoleLogger.error(
        redactSecrets(message, apiKey),
        redactUnknown(error, apiKey),
        redactData(data, apiKey),
      ),
  };
}
