import type { Brand } from './brand.js';

/**
 * Opaque message identifier.
 * Used for deduplication and history correlation of assistant messages.
 */
export type MessageId = Brand<string, 'MessageId'>;

/**
 * Creates or brands a MessageId.
 *
 * - Called with no arguments: generates a new unique message ID.
 * - Called with an existing string: brands it as a MessageId without changing its value.
 *   Use this when rehydrating from serialized data (JSON, database, etc.).
 */
export const MessageId = (value?: string): MessageId => {
  return (value ?? crypto.randomUUID()) as MessageId;
};
