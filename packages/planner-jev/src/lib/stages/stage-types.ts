import type {
  PlannerCandidate,
  PlanningInput,
  Stage,
} from '@maelstrom-co/engine';
import type { TilingNode } from '@maelstrom-co/protocol';

import type { AnswerRecord, JevActionPlan, JevSelection } from '../types.js';

/** A yes/no answer to one gate question. */
export interface GateAnswer {
  readonly answer: 'yes' | 'no';
  readonly probability: number;
  readonly confidence: number;
}

/** Gate answers a select stage may attach to its selection. */
export interface SelectionGates {
  /** Whether the request changes what a widget shows or edits its content, so the actions stage runs. */
  readonly needsActions?: GateAnswer;
  /**
   * Whether the request wants an answer written in the reply, or live
   * outside data no action could take as a parameter; a yes defers the
   * gated select stage.
   */
  readonly generatedContent?: GateAnswer;
  /** Whether the request states where something goes or how large it is. */
  readonly spatial?: GateAnswer;
  /**
   * Whether the request wants content the user already has in a widget,
   * such as today's schedule, the task list, a chart being viewed or an
   * open record, summarised, copied, counted or turned into new content.
   * A view change, showing, hiding or arranging widgets, and text or
   * places the user states do not count. A yes defers the gated select
   * stage.
   */
  readonly dependsOnScreen?: GateAnswer;
}

/** A selection, optionally carrying the select stage's gate answers. */
export type Selection2 = JevSelection & { readonly gates?: SelectionGates };

/** A selection from a select stage that always asks every gate. */
export type GatedSelection = Selection2 & {
  readonly gates: Required<SelectionGates>;
};

/** An action plan with its lowest answer confidence, forwarding its input's gates. */
export type ActionPlan2 = JevActionPlan & {
  readonly selection: Selection2;
  /** Lowest confidence among the answers this stage consumed; 1 when it consumed none. */
  readonly minConfidence: number;
  readonly gates?: SelectionGates;
};

/** An action plan whose gates were all asked, ready for a stage that routes on them alone. */
export type GatedActionPlan = ActionPlan2 & {
  readonly gates: Required<NonNullable<Selection2['gates']>>;
};

/** Where a {@link LayoutDecision} came from. */
export type LayoutSource = 'jev' | 'preserve' | 'default' | 'llm';

/**
 * The layout for an action plan. `tree` undefined hands the layout off:
 * the completion stage asks the LLM to write it.
 */
export interface LayoutDecision {
  readonly plan: ActionPlan2;
  readonly source: LayoutSource;
  readonly layoutId?: string;
  readonly tree?: readonly TilingNode[];
  /**
   * What `tree` does to the current layout, in words for the reply. When
   * set, the completion stage states it in place of `layoutId`.
   */
  readonly layoutSummary?: string;
  readonly answers: readonly AnswerRecord[];
}

export type SelectStage = Stage<PlanningInput, Selection2>;
export type ActionsStage = Stage<Selection2, ActionPlan2>;
export type LayoutStage = Stage<ActionPlan2, LayoutDecision>;
export type CompleteStage = Stage<LayoutDecision, PlannerCandidate>;
