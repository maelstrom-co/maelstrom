/**
 * A time-ordered exchange between named participants.
 *
 * The ownership diagram answers "who holds what"; this answers "what happened,
 * in what order". Barge-in needs the second question because its whole claim is
 * about ordering: the browser protects playback *before* it asks the worker to
 * stop, and a drawing that lost that order would state the opposite.
 */
export interface SequenceModel {
  readonly participants: readonly SequenceParticipant[];
  readonly steps: readonly SequenceStep[];
  /** One-line reading of the whole exchange, used as the SVG's accessible name. */
  readonly summary: string;
}

export interface SequenceParticipant {
  readonly id: string;
  readonly label: string;
  /** `theirs` marks a party you do not operate, matching the ownership diagram. */
  readonly tone: 'yours' | 'theirs';
}

/**
 * Every step kind. The renderer draws one arrow marker per entry, so a kind
 * missing from this list still type-checks and still renders — as a line whose
 * `marker-end` names an id that was never emitted, which SVG draws headless
 * without reporting anything. Keeping the union derived from the list is what
 * stops that.
 *
 * - `media`: audio or media moving between parties.
 * - `intent`: a request, intent, or instruction.
 * - `halt`: a stop, cancel, or protect action — the interrupting half of barge-in.
 */
export const SEQUENCE_STEP_KINDS = ['media', 'intent', 'halt'] as const;

export type SequenceStepKind = (typeof SEQUENCE_STEP_KINDS)[number];

export interface SequenceStep {
  readonly id: string;
  readonly from: string;
  /** Same as `from` for work a participant does to itself, drawn as a loop. */
  readonly to: string;
  readonly label: string;
  readonly kind: SequenceStepKind;
  /**
   * Marks a step as concurrent with the one before it rather than after it.
   * Barge-in protects playback and cancels the worker in the same instant, and
   * numbering them 1, 2 would claim a delay that does not exist.
   */
  readonly withPrevious?: boolean;
}
