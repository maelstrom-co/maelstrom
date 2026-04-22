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
