import type { MessageId } from '@maelstrom-co/protocol';

/**
 * Runtime guard for wire-level request IDs.
 *
 * `requestId` arrives from `JSON.parse` as `unknown`; the `MessageId` brand is
 * a compile-time tag with no runtime presence. Use this guard before routing
 * to the correlator so we don't misroute non-strings (`true`/`42`/`{}`) or
 * empty strings as legitimate ids — the previous truthy check accepted any
 * truthy value and rejected `''`/`0` indiscriminately.
 *
 * The runtime check (`typeof === 'string' && trim().length > 0`) matches the
 * invariant `requireNonEmptyBrand` enforces in the `MessageId` smart
 * constructor (which rejects whitespace-only strings via `trim() === ''`),
 * so claiming the brand here is sound.
 */
export function isCorrelatableId(value: unknown): value is MessageId {
  return typeof value === 'string' && value.trim().length > 0;
}
