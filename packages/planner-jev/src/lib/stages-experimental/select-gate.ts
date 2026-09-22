import type { PlanningInput, Stage } from '@maelstrom-co/engine';
import { isErr, isOk, ok } from '@maelstrom-co/protocol';

import { deferAt } from '../defer.js';
import { noul, type Question, type Reply, readAnswer } from '../questions.js';
import { jevSelect } from '../stages/jev-select.js';
import type { Ask } from '../typesafe-client.js';
import type { GateAnswer, GatedSelection, SelectionGates } from './types.js';

const STAGE = 'jevSelect';

/** A gate answers yes at or above this probability of yes. */
export const GATE_THRESHOLD = 0.5;

const GATE_QUESTIONS: Readonly<Record<keyof SelectionGates, Question>> = {
  needsActions: noul(
    'The latest intent asks for a view change or a content edit, not only showing, hiding, removing or arranging widgets.',
  ),
  generatedContent: noul(
    'The latest intent asks for content that must be invented or fetched rather than performed by a registered action.',
  ),
  spatial: noul(
    'The latest intent states where something goes or how large it is.',
  ),
};

const GATES = Object.keys(GATE_QUESTIONS) as (keyof SelectionGates)[];

/**
 * The POC's selection plus three gates asked in the same call:
 * `needsActions`, `generatedContent` and `spatial`. Generated content
 * defers as unsupported; the other two travel on the selection for later
 * stages.
 */
export function selectWithGates(
  ask: Ask,
): Stage<PlanningInput, GatedSelection> {
  return async (input, ctx) => {
    let reply: Reply | undefined;
    const askWithGates: Ask = async (stage, evaluation, callCtx) => {
      const result = await ask(
        stage,
        {
          ...evaluation,
          questions: { ...evaluation.questions, ...gateQuestions() },
        },
        callCtx,
      );
      if (isOk(result)) reply = result.value;
      return result;
    };
    const selected = await jevSelect(askWithGates)(input, ctx);
    if (isErr(selected)) return selected;
    if (reply === undefined) return deferAt(ctx, STAGE, 'answer_missing');

    const gates: Partial<Record<keyof SelectionGates, GateAnswer>> = {};
    for (const gate of GATES) {
      const answer = readAnswer(reply, gateId(gate), STAGE, ctx);
      if (isErr(answer)) return answer;
      const probability = answer.value.probability ?? 0;
      gates[gate] = {
        answer: probability >= GATE_THRESHOLD ? 'yes' : 'no',
        probability,
        confidence: answer.value.confidence,
      };
    }
    const complete = gates as Required<SelectionGates>;
    if (complete.generatedContent.answer === 'yes')
      return deferAt(
        ctx,
        STAGE,
        'scope_unsupported',
        gateId('generatedContent'),
      );
    return ok({ ...selected.value, gates: complete });
  };
}

function gateQuestions(): Record<string, Question> {
  return Object.fromEntries(
    GATES.map((gate) => [gateId(gate), GATE_QUESTIONS[gate]]),
  );
}

function gateId(gate: keyof SelectionGates): string {
  return `gate/${gate}`;
}
