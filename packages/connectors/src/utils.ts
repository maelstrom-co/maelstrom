import type { MessageId } from '@maelstrom-co/protocol';

/**
 * Determines whether a parsed wire value can identify a protocol message for
 * request correlation.
 *
 * Protocol IDs cross the wire without the compile-time
 * `@maelstrom-co/protocol` `MessageId` brand, so decoded fields must be checked
 * before they are used to address a correlator. This guard accepts strings
 * containing at least one non-whitespace character, including
 * whitespace-padded strings. It rejects empty or whitespace-only strings and
 * every non-string value.
 *
 * The accepted values satisfy the same non-empty invariant as the
 * `MessageId` constructor. The guard does not trim or otherwise transform the
 * value; a successful check only narrows the original value to `MessageId`.
 */
export function isCorrelatableId(value: unknown): value is MessageId {
  return typeof value === 'string' && value.trim().length > 0;
}
