import type { TilingNode } from '@maelstrom-co/protocol-old';

import type { LayoutValidationFailure } from '../../errors.js';

export function checkRationale(
  rationale: string,
  into: LayoutValidationFailure[],
): void {
  if (rationale.trim() === '') {
    into.push({ kind: 'missing_rationale' });
  }
}

export function findDuplicateInstanceIds(
  instanceIds: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of instanceIds) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  return [...duplicates];
}

/**
 * Narrow a `TilingNode` to its leaf-id form. Split directives ('H', 'V') and
 * empty-cell leaves (null) are excluded. Centralized so future additions to
 * the `TilingNode` union can't silently widen "is a leaf" at one call site
 * without the other noticing.
 */
export function isLeafId(node: TilingNode): node is string {
  return node !== null && node !== 'H' && node !== 'V';
}
