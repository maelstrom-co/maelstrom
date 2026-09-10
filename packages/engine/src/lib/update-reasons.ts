import type { UpdateReason } from '@maelstrom-co/protocol';

// An empty reason list is deliberately not resize-only: `every` alone would
// call it one and guard a turn nothing triggered.
//
// This is the single source of truth for both the prompt-side instruction and
// the response-side guard, by decision rather than by accident, and one test
// pins the two to each other. Broadening one of them means introducing a
// second, differently-named predicate, not editing this one.
//
// Neither consumer needs to tell an empty batch from a mixed one, so both
// collapse into `false`. A feature that does need the difference should get a
// discriminated result here rather than re-deriving `reasons.length === 0`.
export function isResizeOnlyBatch(reasons: readonly UpdateReason[]): boolean {
  return (
    reasons.length > 0 &&
    reasons.every((reason) => reason.type === 'chart_resize')
  );
}
