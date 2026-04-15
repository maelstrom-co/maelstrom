import type { Brand } from './brand.js';

/**
 * Opaque session identifier representing a conversation thread.
 * Format is intentionally unspecified — Maelstrom treats it as an opaque string.
 */
export type SessionId = Brand<string, 'SessionId'>;

/**
 * Creates or brands a SessionId.
 *
 * - Called with no arguments: generates a new unique session ID.
 * - Called with an existing string: brands it as a SessionId without changing its value.
 *   Use this when the developer brings their own ID (DB row ID, user ID, etc.).
 *
 * @example
 * // Library fallback
 * const id = SessionId();
 *
 * // Developer-managed
 * const id = SessionId(localStorage.getItem('sessionId') ?? undefined);
 * localStorage.setItem('sessionId', id);
 */
export const SessionId = (value?: string): SessionId => {
  if (value === '') {
    throw new Error(
      'SessionId("") is not allowed. Pass a non-empty string, or omit the argument to generate one.',
    );
  }
  return (value ?? `session-${crypto.randomUUID()}`) as SessionId;
};
