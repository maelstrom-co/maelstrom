/** Bounds and policy for a serializable diagnostic projection. */
export interface DiagnosticSanitizerOptions {
  /** Maximum characters visited in one projection. Defaults to 2000000. */
  readonly maxCharacters?: number;
  /** Maximum retained characters per string. Defaults to 16384. */
  readonly maxStringCharacters?: number;
  /** Additional exact credentials to remove. Never retained by the result. */
  readonly secrets?: readonly string[];
  /** Application policy receives a detached copy; its result is sanitized again. */
  readonly redact?: (value: unknown) => unknown;
}

/** Projects inert, bounded JSON data. Getters, cycles, and prototype keys cannot execute through the projection. */
export function sanitizeDiagnosticValue(
  input: unknown,
  options: DiagnosticSanitizerOptions = {},
): unknown {
  const project = (value: unknown): unknown => {
    let budget = options.maxCharacters ?? 2_000_000;
    let nodes = 0;
    const seen = new WeakSet<object>();
    const marker = (text: string): string => {
      const result = text.slice(
        0,
        Math.max(0, Math.min(options.maxStringCharacters ?? 16384, budget)),
      );
      budget -= result.length;
      return result;
    };
    const walk = (field: unknown, depth: number): unknown => {
      if (budget <= 0 || ++nodes > 10000 || depth > 32)
        return marker('[TRUNCATED]');
      if (field === null || typeof field === 'boolean') return field;
      if (typeof field === 'number')
        return Number.isFinite(field) ? field : null;
      if (typeof field === 'string') {
        let text = field;
        for (const secret of options.secrets ?? [])
          if (secret) text = text.replaceAll(secret, '[REDACTED]');
        text = text
          .replace(/\bsk-[a-zA-Z0-9_-]{32,}/g, '[REDACTED]')
          .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
        const limit = Math.min(options.maxStringCharacters ?? 16384, budget);
        const truncated = text.length > limit;
        const suffix = '[TRUNCATED]';
        text = truncated
          ? text.slice(0, Math.max(0, limit - suffix.length)) +
            suffix.slice(0, limit)
          : text;
        budget -= text.length;
        return text;
      }
      if (typeof field !== 'object') return null;
      if (seen.has(field)) return marker('[CIRCULAR]');
      seen.add(field);
      if (Array.isArray(field)) {
        const result: unknown[] = [];
        for (let i = 0; i < Math.min(field.length, 10000); i++) {
          if (budget <= 0 || nodes > 10000) {
            result.push(marker('[TRUNCATED]'));
            break;
          }
          result.push(
            walk(
              Object.getOwnPropertyDescriptor(field, String(i))?.value,
              depth + 1,
            ),
          );
        }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(field)) {
        if (budget <= 0 || nodes > 10000) break;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
          continue;
        const descriptor = Object.getOwnPropertyDescriptor(field, key);
        if (!descriptor || !('value' in descriptor)) continue;
        if (descriptor.value === undefined) continue;
        budget -= key.length;
        result[key.slice(0, 128)] =
          /^(api[-_]?key|authorization|password|secret|token|access[-_]?token|client[-_]?secret)$/i.test(
            key,
          )
            ? marker('[REDACTED]')
            : walk(descriptor.value, depth + 1);
      }
      return result;
    };
    return walk(value, 0);
  };
  const detached = project(input);
  return options.redact ? project(options.redact(detached)) : detached;
}
