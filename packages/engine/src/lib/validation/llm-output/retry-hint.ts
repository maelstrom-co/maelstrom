import { isInstanceIdNode } from '@maelstrom-co/protocol';

import { assertNever } from '../../assert-never.js';
import type { SkippedAction } from '../../response/execution-plan/index.js';

import type { HealedLayout, RetryHint } from './healed-layout.js';

interface DeriveRetryHintInput {
  readonly healedLayoutSize: number;
  readonly requestInstanceCount: number;
  readonly proposedActionCount: number;
  readonly acceptedActionCount: number;
  readonly skippedActions: readonly SkippedAction[];
  readonly droppedLayoutCount: number;
  readonly warningCount: number;
}

/**
 * Recommend retry when the user would experience a no-op or empty UI —
 * either the rendered layout is empty (request asked for instances) or
 * every proposed action got dropped for a re-promptable reason. A partial
 * layout + partial execution plan does NOT recommend retry; partial UI
 * update beats waiting for a re-roll.
 *
 * `state_drift` skips are excluded from "re-promptable" because they
 * indicate engine-state corruption that re-prompting can't fix. But the
 * presence of one drift skip alongside an otherwise-fixable failure does
 * not suppress retry — if any skipped action is fixable AND no actions
 * survived, retry has a chance of producing a usable plan.
 *
 * `severity = 'unrecoverable'` is reserved for the layout-empty case. The
 * action-empty-only case is `'medium' + recommend: true` — the layout
 * itself is renderable.
 */
export function deriveRetryHint(input: DeriveRetryHintInput): RetryHint {
  const layoutEmptyWhenNeeded =
    input.healedLayoutSize === 0 && input.requestInstanceCount > 0;

  if (layoutEmptyWhenNeeded) {
    return { severity: 'unrecoverable', recommend: true };
  }

  const anySkipFixable = input.skippedActions.some(
    (s) => s.reason !== 'state_drift',
  );
  const actionsAllSkippedForFixableReason =
    input.proposedActionCount > 0 &&
    input.acceptedActionCount === 0 &&
    anySkipFixable;

  if (actionsAllSkippedForFixableReason) {
    return { severity: 'medium', recommend: true };
  }

  if (input.droppedLayoutCount > 0 || input.skippedActions.length > 0) {
    return { severity: 'medium', recommend: false };
  }

  if (input.warningCount > 0) {
    return { severity: 'low', recommend: false };
  }

  return { severity: 'none', recommend: false };
}

/**
 * Counts renderable instances. For grid: number of positions. For tiling:
 * non-null instance leaves only — `H`/`V` splits and `null` empty-space
 * nodes don't render anything, so a tree like `[null]` or `['H', null,
 * null]` has token count > 0 but renders nothing. Counting only
 * `isInstanceIdNode(...)` nodes makes `layoutEmptyWhenNeeded` fire when the
 * healed UI would actually be blank.
 */
export function layoutEntryCount(healed: HealedLayout): number {
  switch (healed.mode) {
    case 'grid':
      return healed.layout.positions.length;
    case 'tiling': {
      let renderableLeaves = 0;
      for (const node of healed.layout.tree) {
        if (isInstanceIdNode(node)) renderableLeaves += 1;
      }
      return renderableLeaves;
    }
    default:
      return assertNever(healed, 'layoutEntryCount');
  }
}
