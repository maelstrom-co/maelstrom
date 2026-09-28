import type {
  Deferred,
  PlanningInput,
  Stage,
  StageContext,
} from '@maelstrom-co/engine';
import { isErr, isOk, ok, type Result } from '@maelstrom-co/protocol';

import { deferAt, STAGE_NAME } from '../defer.js';
import { noul, type Question, type Reply, readAnswer } from '../questions.js';
import type { Ask } from '../typesafe-client.js';
import { jevSelect } from './jev-select.js';
import type {
  GateAnswer,
  GatedSelection,
  SelectionGates,
} from './stage-types.js';

const STAGE = STAGE_NAME.jevSelect;

/**
 * Every gate except `needsActions` answers yes at or above this
 * probability of yes.
 */
export const GATE_THRESHOLD = 0.5;

/**
 * `needsActions` answers yes at or above this probability of yes. It sits
 * below {@link GATE_THRESHOLD} because a false no silently drops the
 * actions the user asked for, while a false yes only costs one actions
 * call that can still answer none.
 */
export const NEEDS_ACTIONS_THRESHOLD = 0.3;

const GATE_QUESTIONS: Readonly<Record<keyof SelectionGates, Question>> = {
  needsActions: noul(
    'The latest intent asks to change what a widget shows or to edit its content, including a different view of its data such as a route, directions, a forecast, a chart, a history or a detail view; not only showing, hiding, removing or arranging widgets.',
  ),
  generatedContent: noul(
    "The latest intent wants an answer written in the reply itself, or live data from outside the app, that no widget action could take as a parameter. Text for an action's parameter does not count, even when it must be composed or looked up from general knowledge.",
  ),
  spatial: noul(
    'The latest intent states where something goes or how large it is.',
  ),
  dependsOnScreen: noul(
    "The latest intent wants content the user already has in a widget, such as today's schedule, the task list, a chart being viewed or an open record, summarised, copied, counted or turned into new content, including writing about the user's own plans, events or tasks without spelling them out. Showing, hiding, removing or arranging widgets, changing a view, and text or places the user states or said earlier do not count.",
  ),
};

const GATE_THRESHOLDS: Readonly<Record<keyof SelectionGates, number>> = {
  needsActions: NEEDS_ACTIONS_THRESHOLD,
  generatedContent: GATE_THRESHOLD,
  spatial: GATE_THRESHOLD,
  dependsOnScreen: GATE_THRESHOLD,
};

/** The gates {@link selectGated} asks, in the order it asks them. */
export const SELECTION_GATES: readonly (keyof SelectionGates)[] = Object.keys(
  GATE_QUESTIONS,
) as (keyof SelectionGates)[];

/**
 * The POC's selection plus four gates asked in the same call:
 * `needsActions`, `generatedContent`, `spatial` and `dependsOnScreen`.
 * `needsActions` answers yes from {@link NEEDS_ACTIONS_THRESHOLD}, the
 * others from {@link GATE_THRESHOLD}. Generated content defers
 * `scope_unsupported`; otherwise a value that can only be read off the
 * screen defers `screen_content_unavailable`, since the request carries no
 * widget content. `needsActions` and `spatial` travel on the selection for
 * later stages.
 */
export function selectGated(ask: Ask): Stage<PlanningInput, GatedSelection> {
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

    const gates = readGateAnswers(reply, ctx);
    if (isErr(gates)) return gates;
    const complete = gates.value;
    if (complete.generatedContent.answer === 'yes')
      return deferAt(
        ctx,
        STAGE,
        'scope_unsupported',
        gateId('generatedContent'),
      );
    if (complete.dependsOnScreen.answer === 'yes')
      return deferAt(
        ctx,
        STAGE,
        'screen_content_unavailable',
        gateId('dependsOnScreen'),
      );
    return ok({ ...selected.value, gates: complete });
  };
}

/**
 * Every gate answer in `reply`, `needsActions` answering yes at or above
 * {@link NEEDS_ACTIONS_THRESHOLD} and every other gate at or above
 * {@link GATE_THRESHOLD}. Defers `answer_missing` when a gate has no answer.
 */
export function readGateAnswers(
  reply: Reply,
  ctx: StageContext,
): Result<Required<SelectionGates>, Deferred> {
  const gates: Partial<Record<keyof SelectionGates, GateAnswer>> = {};
  for (const gate of SELECTION_GATES) {
    const answer = readAnswer(reply, gateId(gate), STAGE, ctx);
    if (isErr(answer)) return answer;
    const probability = answer.value.probability ?? 0;
    gates[gate] = {
      answer: probability >= GATE_THRESHOLDS[gate] ? 'yes' : 'no',
      probability,
      confidence: answer.value.confidence,
    };
  }
  return ok(gates as Required<SelectionGates>);
}

function gateQuestions(): Record<string, Question> {
  return Object.fromEntries(
    SELECTION_GATES.map((gate) => [gateId(gate), GATE_QUESTIONS[gate]]),
  );
}

function gateId(gate: keyof SelectionGates): string {
  return `gate/${gate}`;
}
