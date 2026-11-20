import type { ChangeId } from '@maelstrom-co/protocol';

/**
 * How a `change_screen` call ended.
 *
 * - `applied`: the screen confirmed the change, or already showed the goal.
 * - `failed`: the Planner could not plan the goal, or some steps did not run.
 * - `unknown`: a change went out but the screen did not confirm it, because
 *   the acknowledgement timed out or the run stopped waiting first. It may
 *   still have been applied. Also a goal that needed no change while an
 *   earlier change was still unconfirmed, so the screen may not show it.
 * - `needs_clarification`: the Planner needs the user to answer a question.
 * - `cancelled`: the run stopped waiting before the change went out, or the
 *   connection closed.
 * - `queued`: reserved for Ambient Screen Changes. Never produced yet.
 */
export type ScreenChangeStatus =
  | 'applied'
  | 'failed'
  | 'unknown'
  | 'needs_clarification'
  | 'cancelled'
  | 'queued';

/** What one `change_screen` call answers the loop model. */
export interface ScreenChangeResult {
  /** How the call ended. */
  readonly status: ScreenChangeStatus;
  /**
   * An Engine-written line naming the status and the quoted goal, at most
   * {@link SCREEN_CHANGE_SUMMARY_MAX_CHARS} characters. Never Planner text.
   */
  readonly summary: string;
  /** The change the browser received for this goal, present whenever a `ui_change` went out. */
  readonly changeId?: ChangeId;
  /** The question to ask the user, present on `needs_clarification`. */
  readonly question?: string;
  /** Suggested answers to {@link question}. */
  readonly options?: readonly string[];
  /**
   * Vessel ids visible in the layout the screen shows after this change: the
   * layout sent, or the current one when nothing was sent. Present only on a
   * clarification that carried no per-goal verdicts, and only when the
   * screen confirmed that layout.
   */
  readonly onScreen?: readonly string[];
}

/**
 * What {@link describeScreenChangeResult} reads. `already_on_screen` and
 * `partially_failed` are the `applied` and `failed` summaries with their
 * reason.
 */
export type ScreenChangeOutcome =
  | Exclude<ScreenChangeStatus, 'queued'>
  | 'already_on_screen'
  | 'partially_failed';

/** Most characters a {@link ScreenChangeResult.summary} takes. */
export const SCREEN_CHANGE_SUMMARY_MAX_CHARS = 200;

/**
 * Builds the summary of a `change_screen` result, such as
 * `applied: "show order o-1"` or
 * `failed (some steps did not run): "show order o-1"`. The goal is shortened
 * inside its quotes, ending with an ellipsis, so the summary stays within
 * {@link SCREEN_CHANGE_SUMMARY_MAX_CHARS}.
 */
export function describeScreenChangeResult(
  goal: string,
  outcome: ScreenChangeOutcome,
): string {
  const label = OUTCOME_LABELS[outcome];
  const room = SCREEN_CHANGE_SUMMARY_MAX_CHARS - label.length - 4;
  const quoted =
    goal.length <= room ? goal : `${goal.slice(0, Math.max(0, room - 1))}…`;
  return `${label}: "${quoted}"`;
}

const OUTCOME_LABELS: Record<ScreenChangeOutcome, string> = {
  applied: 'applied',
  already_on_screen: 'applied (already on screen)',
  failed: 'failed',
  partially_failed: 'failed (some steps did not run)',
  unknown: 'unknown (the screen did not confirm)',
  needs_clarification: 'needs clarification',
  cancelled: 'cancelled',
};
