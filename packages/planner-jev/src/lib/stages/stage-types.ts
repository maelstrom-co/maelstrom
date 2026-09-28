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
  readonly needsActions?: GateAnswer;
  readonly generatedContent?: GateAnswer;
  readonly spatial?: GateAnswer;
  /** Whether a value the request needs can only be read from what a widget currently shows. */
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
