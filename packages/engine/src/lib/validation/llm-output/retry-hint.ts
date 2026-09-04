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
 * Predicate for skip reasons the Engine permits to trigger an LLM retry.
 * Ordinary parse and validation failures are fixable because a new response
 * can correct them. The non-retryable cases are:
 * - `state_drift`: engine-state mismatch the LLM doesn't have visibility
 *   into; feedback would be noise.
 * - `self_transition_noop`: LLM emitted a transition action whose target
 *   equals the simulator's current variant; the chart is already in the
 *   desired variant and the LLM has nothing useful to change on retry.
 * - parameter work limits: fail closed without repeating over-budget work,
 *   even though a later independent request may supply a smaller value.
 * - invalid definitions: only the application can correct the authored Action
 *   definition.
 */
export function isFixableSkip(reason: SkippedAction['reason']): boolean {
  switch (reason) {
    case 'state_drift':
    case 'self_transition_noop':
    case 'params_limits_exceeded':
    case 'invalid_action_definition':
      return false;
    case 'unknown_instance':
    case 'unknown_vessel':
    case 'no_simulated_variant':
    case 'variant_not_on_vessel':
    case 'action_not_valid':
    case 'params_parse_failed':
    case 'params_validation_failed':
      return true;
    default:
      return assertNever(reason, 'isFixableSkip');
  }
}

/**
 * Recommend retry when the user would experience a no-op or empty UI —
 * either the rendered layout is empty (request asked for instances) or
 * every proposed action got dropped for a re-promptable reason. A partial
 * layout + partial execution plan does NOT recommend retry; partial UI
 * update beats waiting for a re-roll.
 *
 * Non-fixable skips (see {@link isFixableSkip}) don't suppress retry on
 * their own — if any *other* skip in the same response is fixable AND no
 * actions survived, retry still has a chance of producing a usable plan.
 *
 * Layout drops arrive as a count, never as reasons, and deliberately so: a
 * response whose only fault is a repeated leaf that left a survivor ships
 * without a retry, because blanking the repeat leaves a layout the user can
 * use and a re-roll would cost a round trip to close a cosmetic gap. Drops
 * severe enough to matter empty the layout and are caught above.
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

  const anySkipFixable = input.skippedActions.some((s) =>
    isFixableSkip(s.reason),
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
