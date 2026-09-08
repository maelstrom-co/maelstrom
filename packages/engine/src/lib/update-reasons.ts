import type { UpdateReason } from '@maelstrom-co/protocol';

// An empty reason list is deliberately not resize-only — `every` alone would
// call it one and guard a turn nothing triggered. Shared so the prompt-side
// instruction and the response-side guard cannot drift apart.
export function isResizeOnlyBatch(reasons: readonly UpdateReason[]): boolean {
  return (
    reasons.length > 0 &&
    reasons.every((reason) => reason.type === 'chart_resize')
  );
}
