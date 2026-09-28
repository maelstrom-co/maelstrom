import type { AnswerRecord, ParameterAsk, PlannedAction } from '../types.js';
import type { ActionPlan2, Selection2 } from './stage-types.js';

/** An action plan over `answers`, forwarding the selection's gates. */
export function actionPlanOf(
  selection: Selection2,
  actions: readonly PlannedAction[],
  asks: readonly ParameterAsk[],
  answers: readonly AnswerRecord[],
): ActionPlan2 {
  return {
    selection,
    actions,
    asks,
    answers,
    minConfidence: Math.min(1, ...answers.map((answer) => answer.confidence)),
    ...(selection.gates !== undefined && { gates: selection.gates }),
  };
}
