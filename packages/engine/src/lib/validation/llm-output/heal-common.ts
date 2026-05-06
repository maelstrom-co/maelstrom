import type {
  GridResponse,
  InstanceId,
  TilingResponse,
} from '@maelstrom-co/protocol';

import type { DroppedLayoutEntry, LayoutWarning } from './healed-layout.js';

/**
 * Pushes a `missing_rationale` warning when the response's rationale is
 * empty or whitespace-only. Centralizes the warning-emission rule across
 * both heal functions so future tightening (e.g. minimum length, banned
 * placeholder text) lands in one place.
 */
export function pushMissingRationaleWarningIfEmpty(
  response: GridResponse | TilingResponse,
  warnings: LayoutWarning[],
): void {
  if (response.rationale.trim() === '') {
    warnings.push({ kind: 'missing_rationale' });
  }
}

/**
 * First-occurrence-wins instance-id tracker. Both heal functions enforce
 * the same policy: the first appearance of an `instanceId` is kept, every
 * subsequent appearance is recorded as a `duplicate_instance_id` drop and
 * skipped from further validation. Centralizing the policy here means a
 * future change (e.g. last-wins, or strict reject-all-duplicates) lands
 * in one place rather than diverging across grid/tiling heal.
 *
 * Usage at each loop iteration:
 *
 *     if (tracker.isDuplicate(id)) continue;
 *     // ... per-position/per-instance validation ...
 *     if (!dropped) tracker.markSeen(id);
 */
export interface SeenInstancesTracker {
  /**
   * If `id` was already marked as seen, pushes a `duplicate_instance_id`
   * drop into `drops` (the array passed at construction) and returns true.
   * Does NOT mark `id` as seen — the heal function decides whether the
   * non-duplicate-instance is actually kept (it may still fail other
   * validation) before calling `markSeen`.
   */
  readonly isDuplicate: (id: InstanceId) => boolean;
  /** Records `id` as seen. Call only after the instance survives validation. */
  readonly markSeen: (id: InstanceId) => void;
}

export function seenInstancesTracker(
  drops: DroppedLayoutEntry[],
): SeenInstancesTracker {
  const seen = new Set<InstanceId>();
  return {
    isDuplicate(id) {
      if (seen.has(id)) {
        drops.push({ reason: 'duplicate_instance_id', instanceId: id });
        return true;
      }
      return false;
    },
    markSeen(id) {
      seen.add(id);
    },
  };
}
