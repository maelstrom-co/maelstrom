import {
  isErr,
  ok,
  type VariantName,
  type VesselAction,
} from '@maelstrom-co/protocol';

import { deferAt } from '../defer.js';
import { finalVariants, legalActions } from '../final-variants.js';
import {
  bindParameterChoices,
  enumSnapshotOf,
  type ParameterSlot,
  parameterQuestions,
} from '../parameter-questions.js';
import {
  choice,
  intentText,
  isResizeOnly,
  type Question,
  readAnswer,
  recentHistory,
} from '../questions.js';
import { MAX_ACTIONS } from '../stages/jev-actions.js';
import type {
  AnswerRecord,
  ParameterAsk,
  PlannedAction,
  SelectedInstance,
} from '../types.js';
import type { Ask } from '../typesafe-client.js';
import { actionPlanOf } from './action-plan.js';
import { askInChunks, type FanOutOptions } from './fan-out.js';
import type { ActionsStage, Selection2 } from './types.js';

const STAGE = 'jevActions';

/** Overrides for the call the stage splits its questions over. */
export type PerInstanceBatchedActionsOptions = FanOutOptions;

/**
 * Plans each instance's actions in one call: numbered slots per instance,
 * the second slot's options labelled with the view the first leaves it in,
 * and the parameters of every action any slot could pick asked alongside.
 * Code walks each instance's slots and keeps a second answer only when its
 * premise matches the first answer; a mismatch defers
 * `premise_mismatch`. A third slot is asked and never planned: an answer
 * naming an action defers `action_limit` rather than shipping the first two
 * actions as if that were the whole request, and the call record keeps every
 * third-slot answer for measurement. Actions keep their order within an
 * instance, not across instances. The questions are split over as few
 * concurrent calls as the byte budget of {@link askInChunks} allows, since
 * one call over all of them can exceed what TypeSafe accepts. A resize-only
 * request, or a `needsActions` gate answering no, plans no actions and makes
 * no call.
 */
export function perInstanceBatchedActions(
  ask: Ask,
  options: PerInstanceBatchedActionsOptions = {},
): ActionsStage {
  return async (selection, ctx) => {
    const { request } = selection.input;
    const retained = selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    if (isResizeOnly(request) || selection.gates?.needsActions?.answer === 'no')
      return ok(actionPlanOf(selection, [], [], []));

    const intent = intentText(request);
    const snapshot = enumSnapshotOf(request, ctx);
    const plans = retained.map((instance) =>
      instanceQuestions(instance, request.vessels, (slot, target, lead) =>
        parameterQuestions(
          target.definition.parameters ?? [],
          `param/${instance.instanceId}/${slot}/${target.label}`,
          lead,
          intent,
          snapshot,
        ),
      ),
    );
    const questions: Record<string, Question> = Object.assign(
      {},
      ...plans.map((plan) => plan.questions),
    );
    const reply = await askInChunks(
      ask,
      STAGE,
      {
        state: {
          intent: request.context.updateReasons,
          history: recentHistory(selection.input.history),
          instances: retained.map((instance) => ({
            instanceId: instance.instanceId,
            vesselId: instance.vesselId,
            variant: instance.variant,
            visible: instance.visible,
          })),
        },
        questions,
      },
      ctx,
      options,
    );
    if (isErr(reply)) return reply;

    const answers: AnswerRecord[] = [];
    const read = (id: string) => {
      const answer = readAnswer(reply.value, id, STAGE, ctx);
      if (!isErr(answer))
        answers.push({ stage: STAGE, question: id, ...answer.value });
      return answer;
    };
    const walked: { instance: SelectedInstance; target: SlotTarget }[] = [];
    for (const plan of plans) {
      const { instance } = plan;
      const first = read(slotId(instance, 1));
      if (isErr(first)) return first;
      if (first.value.choice === 'none') continue;
      if (first.value.choice === 'unsupported')
        return deferAt(ctx, STAGE, 'action_unsupported', slotId(instance, 1));
      const firstTarget = plan.first.get(first.value.choice);
      if (!firstTarget)
        return deferAt(ctx, STAGE, 'answer_missing', slotId(instance, 1));
      walked.push({ instance, target: firstTarget });

      const second = read(slotId(instance, 2));
      if (isErr(second)) return second;
      if (second.value.choice === 'none') continue;
      if (second.value.choice === 'unsupported')
        return deferAt(ctx, STAGE, 'action_unsupported', slotId(instance, 2));
      const secondTarget = plan.second.get(second.value.choice);
      if (!secondTarget)
        return deferAt(ctx, STAGE, 'answer_missing', slotId(instance, 2));
      if (secondTarget.variant !== after(firstTarget))
        return deferAt(ctx, STAGE, 'premise_mismatch', slotId(instance, 2));
      walked.push({ instance, target: secondTarget });

      const third = readAnswer(reply.value, slotId(instance, 3), STAGE, ctx);
      if (isErr(third)) return third;
      if (third.value.choice !== 'none' && third.value.choice !== 'unsupported')
        return deferAt(ctx, STAGE, 'action_limit', slotId(instance, 3));
    }
    if (walked.length > MAX_ACTIONS) return deferAt(ctx, STAGE, 'action_limit');

    const choices: Record<string, string> = {};
    for (const { target } of walked)
      for (const slot of target.slots) {
        const answer = read(slot.id);
        if (isErr(answer)) return answer;
        choices[slot.id] = answer.value.choice;
      }
    const actions: PlannedAction[] = [];
    const asks: ParameterAsk[] = [];
    for (const { instance, target } of walked) {
      const bound = bindParameterChoices(target.slots, choices);
      const planned = {
        instanceId: instance.instanceId,
        action: target.definition.name,
      };
      if (bound.missing.length === 0)
        actions.push({
          ...planned,
          params: bound.params,
          pending: bound.pending,
        });
      else
        asks.push(
          ...bound.missing.map((parameter) => ({ ...planned, parameter })),
        );
    }
    if (isErr(finalVariants(retained, actions, request.vessels)))
      return deferAt(ctx, STAGE, 'simulation_failed');
    return ok(actionPlanOf(selection, actions, asks, answers));
  };
}

interface SlotTarget {
  /** The option key: the action name, prefixed with its premise view after the first slot. */
  readonly label: string;
  /** The view the action runs in. */
  readonly variant: VariantName;
  readonly definition: VesselAction;
  readonly slots: readonly ParameterSlot[];
}

interface InstancePlan {
  readonly instance: SelectedInstance;
  readonly first: ReadonlyMap<string, SlotTarget>;
  readonly second: ReadonlyMap<string, SlotTarget>;
  readonly questions: Readonly<Record<string, Question>>;
}

type AskParameters = (
  slot: 1 | 2,
  target: Omit<SlotTarget, 'slots'>,
  lead: string,
) => { slots: readonly ParameterSlot[]; questions: Record<string, Question> };

function instanceQuestions(
  instance: SelectedInstance,
  vessels: Selection2['input']['request']['vessels'],
  parametersOf: AskParameters,
): InstancePlan {
  const { instanceId, variant } = instance;
  const questions: Record<string, Question> = {};
  const withParameters = (
    slot: 1 | 2,
    target: Omit<SlotTarget, 'slots'>,
    lead: string,
  ): SlotTarget => {
    const asked = parametersOf(slot, target, lead);
    Object.assign(questions, asked.questions);
    return { ...target, slots: asked.slots };
  };

  const first = new Map<string, SlotTarget>();
  for (const definition of legalActions(instance.vesselId, variant, vessels))
    first.set(
      definition.name,
      withParameters(
        1,
        { label: definition.name, variant, definition },
        `For the first action on ${instanceId}, ${definition.name}`,
      ),
    );
  const premises = [...new Set([...first.values()].map(after))];
  const second = new Map<string, SlotTarget>();
  for (const premise of premises)
    for (const definition of legalActions(instance.vesselId, premise, vessels))
      second.set(
        `${premise}:${definition.name}`,
        withParameters(
          2,
          {
            label: `${premise}:${definition.name}`,
            variant: premise,
            definition,
          },
          `For the second action on ${instanceId}, ${definition.name} in its ${premise} view`,
        ),
      );
  const thirdPremises = [...new Set([...second.values()].map(after))];

  questions[slotId(instance, 1)] = choice(
    `Choose the first action the latest intent requests on ${instanceId}, currently in its ${variant} view. ${VIEW_RULE} Choose none when it requests no view change or content edit on ${instanceId}.`,
    {
      ...slotCriteria(first, () => ''),
      none: `The latest intent requests no view change or content edit on ${instanceId}.`,
      unsupported: `A requested view change or content edit on ${instanceId} cannot be performed with these actions.`,
    },
  );
  questions[slotId(instance, 2)] = choice(
    `Choose the second action the latest intent requests on ${instanceId}, after its first one. Each option assumes the view the first action leaves it in. ${VIEW_RULE} Choose none when it requests at most one action on ${instanceId}.`,
    {
      ...slotCriteria(
        second,
        (target) =>
          `If its first action leaves it in its ${target.variant} view: `,
      ),
      none: `The latest intent requests at most one action on ${instanceId}.`,
      unsupported: `A second requested action on ${instanceId} cannot be performed with these actions.`,
    },
  );
  const third: Record<string, string> = {};
  for (const premise of thirdPremises)
    for (const definition of legalActions(instance.vesselId, premise, vessels))
      third[`${premise}:${definition.name}`] =
        `If its second action leaves it in its ${premise} view: ${describe(definition)}`;
  questions[slotId(instance, 3)] = choice(
    `Choose the third action the latest intent requests on ${instanceId}, after its first two. Each option assumes the view the second action leaves it in. Choose none when it requests at most two actions on ${instanceId}.`,
    {
      ...third,
      none: `The latest intent requests at most two actions on ${instanceId}.`,
      unsupported: `A third requested action on ${instanceId} cannot be performed with these actions.`,
    },
  );
  return { instance, first, second, questions };
}

const VIEW_RULE =
  'A view change is an action: choose the action that switches to the requested view. Showing, hiding or arranging widgets needs no action.';

function slotCriteria(
  targets: ReadonlyMap<string, SlotTarget>,
  premise: (target: SlotTarget) => string,
): Record<string, string> {
  return Object.fromEntries(
    [...targets].map(([key, target]) => [
      key,
      `${premise(target)}${describe(target.definition)}`,
    ]),
  );
}

function describe(definition: VesselAction): string {
  return `${definition.name}. ${definition.description}${definition.transitionsTo ? ` Switches it to its ${definition.transitionsTo} view.` : ''}`;
}

function after(target: Omit<SlotTarget, 'slots'>): VariantName {
  return target.definition.transitionsTo ?? target.variant;
}

function slotId(instance: SelectedInstance, slot: 1 | 2 | 3): string {
  return `${instance.instanceId}/${slot}`;
}
