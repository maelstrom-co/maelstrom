import { type Brand, requireNonEmptyBrand } from './brand.js';

/**
 * Opaque session identifier representing a conversation thread.
 * Format is intentionally unspecified — Maelstrom treats it as an opaque string.
 */
export type SessionId = Brand<string, 'SessionId'>;

/**
 * Creates or brands a SessionId. Smart constructor — the identifier
 * `SessionId` refers to both the type (for type annotations) and the factory
 * (for runtime creation), exploiting TypeScript's separate type/value namespaces.
 *
 * - Called with no arguments: generates a new unique session ID with a
 *   `session-` prefix for easy log grepping.
 * - Called with an existing string: brands it as a SessionId without changing
 *   its value. Use this when the developer brings their own ID (DB row ID,
 *   user ID, persisted localStorage value, etc.) or when rehydrating from
 *   serialized data.
 */
export const SessionId = (value?: string): SessionId => {
  if (value !== undefined) {
    requireNonEmptyBrand(value, 'SessionId');
  }
  return (value ?? `session-${crypto.randomUUID()}`) as SessionId;
};
