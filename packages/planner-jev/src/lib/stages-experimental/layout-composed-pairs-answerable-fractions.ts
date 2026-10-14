import type { Stage } from '@maelstrom-co/engine';
import type { Ask } from '../ask.js';
import type { Question } from '../questions.js';
import {
  type ComposedPairsDecision,
  layoutComposedPairsGateAndDefer,
} from '../stages/layout-composed-pairs-gate-and-defer.js';
import type { GatedActionPlan } from '../stages/stage-types.js';

/**
 * `ask` with every `fraction_in_group/<instance>` question told to answer
 * half when the request states no fraction. OpenAI Decisions refuses that
 * score question when no level fits; the stage reads the fraction only
 * where `size_stated_in_group` says one was stated.
 *
 * @experimental
 */
export function withAnswerableFractions(ask: Ask): Ask {
  return (stage, evaluation, ctx) => {
    const questions: Record<string, Question> = {};
    for (const [id, question] of Object.entries(evaluation.questions))
      questions[id] =
        id.startsWith(FRACTION_PREFIX) && question.type === 'score'
          ? {
              ...question,
              instructions: `${question.instructions}${UNSTATED_FRACTION}`,
            }
          : question;
    return ask(stage, { ...evaluation, questions }, ctx);
  };
}

/**
 * `layoutComposedPairsGateAndDefer` on {@link withAnswerableFractions}.
 *
 * @experimental
 */
export function layoutComposedPairsAnswerableFractions(
  ask: Ask,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  return layoutComposedPairsGateAndDefer(withAnswerableFractions(ask));
}

const FRACTION_PREFIX = 'fraction_in_group/';

const UNSTATED_FRACTION =
  ' When the `request` states no such fraction, answer half of its row or column: the answer is then ignored.';
