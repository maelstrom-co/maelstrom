import type {
  CancellationError,
  Deferred,
  Stage,
  StageContext,
} from '@maelstrom-co/engine';
import {
  err,
  isErr,
  ok,
  type Result,
  type VariantName,
  type VesselAction,
} from '@maelstrom-co/protocol';

import { deferAt } from '../defer.js';
import { finalVariants, legalActions } from '../final-variants.js';
import {
  bindParameterChoices,
  enumSnapshotOf,
  parameterQuestions,
} from '../parameter-questions.js';
import {
  type ConfidencePolicy,
  choice,
  intentText,
  isResizeOnly,
  readAnswer,
  recentHistory,
} from '../questions.js';
import type {
  AnswerRecord,
  JevActionPlan,
  JevSelection,
  ParameterAsk,
  PendingParameter,
  PlannedAction,
  SelectedInstance,
} from '../types.js';
import type { Ask } from '../typesafe-client.js';

const STAGE = 'jevActions';
/** Planned actions per request; choosing a fifth defers. */
export const MAX_ACTIONS = 4;

interface ActionOption {
  readonly key: string;
  readonly instance: SelectedInstance;
  readonly variant: VariantName;
  readonly definition: VesselAction;
}

type StepResult = Result<
  | { readonly kind: 'planned'; readonly action: PlannedAction }
  | { readonly kind: 'dropped'; readonly asks: readonly ParameterAsk[] },
  Deferred | CancellationError
>;

/**
 * Plans the ordered actions, one Jev call per step, offering every legal
 * action on every retained instance at the variant earlier steps leave it
 * in (transitions included). After a step picks an action with parameters,
 * one more call binds them: a candidate value, `omit` for an optional one,
 * `stated_elsewhere` (the LLM fills it) or `not_stated` (the action is
 * dropped and the user is asked for the value). A resize-only request plans
 * no actions and makes no call.
 */
export function jevActions(
  ask: Ask,
  policy: ConfidencePolicy = {},
): Stage<JevSelection, JevActionPlan> {
  return async (selection, ctx) => {
    const { request } = selection.input;
    const retained = selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    const actions: PlannedAction[] = [];
    const asks: ParameterAsk[] = [];
    const answers: AnswerRecord[] = [];
    // The Engine refuses content mutations on resize-only turns, and asking
    // Jev anyway invites an `unsupported` answer that forces the fallback.
    if (isResizeOnly(request)) return ok({ selection, actions, asks, answers });

    for (let step = 0; ; step++) {
      const simulated = finalVariants(retained, actions, request.vessels);
      if (isErr(simulated))
        return deferAt(ctx, STAGE, 'simulation_failed', `action/${step}`);
      const options: ActionOption[] = [];
      for (const instance of retained) {
        const variant =
          simulated.value.get(instance.instanceId) ?? instance.variant;
        for (const definition of legalActions(
          instance.vesselId,
          variant,
          request.vessels,
        ))
          options.push({
            key: `a${options.length}`,
            instance,
            variant,
            definition,
          });
      }

      const id = `action/${step}`;
      const criteria: Record<string, string> = {
        done: 'Every requested view change and content edit is already planned, or none was requested. Showing, hiding or arranging widgets needs no action.',
        unsupported:
          'A remaining requested view change or content edit cannot be performed with these actions.',
      };
      for (const option of options)
        criteria[option.key] =
          `${option.instance.instanceId}, currently ${option.variant}: ${option.definition.name}. ${option.definition.description}${option.definition.transitionsTo ? ` Switches it to its ${option.definition.transitionsTo} view.` : ''}`;
      const reply = await ask(
        STAGE,
        {
          state: {
            intent: request.context.updateReasons,
            history: recentHistory(selection.input.history),
            instances: retained.map((instance) => ({
              instanceId: instance.instanceId,
              vesselId: instance.vesselId,
              variant: simulated.value.get(instance.instanceId),
              visible: instance.visible,
            })),
            previousActions: actions.map(({ instanceId, action, params }) => ({
              instanceId,
              action,
              params,
            })),
            droppedActions: asks.map(({ instanceId, action }) => ({
              instanceId,
              action,
            })),
          },
          questions: {
            [id]: choice(
              'Choose the next remaining action the latest intent requests, in the order the user asked for them. previousActions are already planned with their parameters; do not choose them again unless the user asked for a repetition. droppedActions cannot run for lack of a value; do not choose them again. A view change is an action: choose the action that switches to the requested view. Choose done when nothing requested remains.',
              criteria,
            ),
          },
        },
        ctx,
      );
      if (isErr(reply)) return reply;
      const answer = readAnswer(reply.value, id, STAGE, ctx, policy);
      if (isErr(answer)) return answer;
      answers.push({ stage: STAGE, question: id, ...answer.value });
      if (answer.value.choice === 'done') break;
      if (answer.value.choice === 'unsupported')
        return deferAt(ctx, STAGE, 'action_unsupported', id);
      if (step === MAX_ACTIONS) return deferAt(ctx, STAGE, 'action_limit', id);
      const chosen = options.find(
        (option) => option.key === answer.value.choice,
      );
      if (!chosen) return deferAt(ctx, STAGE, 'answer_missing', id);

      const bound = await bindParameters(
        ask,
        policy,
        selection,
        chosen,
        step,
        actions,
        answers,
        ctx,
      );
      if (isErr(bound)) return bound;
      if (bound.value.kind === 'planned') actions.push(bound.value.action);
      else asks.push(...bound.value.asks);
    }
    return ok({ selection, actions, asks, answers });
  };
}

async function bindParameters(
  ask: Ask,
  policy: ConfidencePolicy,
  selection: JevSelection,
  chosen: ActionOption,
  step: number,
  previous: readonly PlannedAction[],
  answers: AnswerRecord[],
  ctx: StageContext,
): Promise<StepResult> {
  const { request } = selection.input;
  const parameters = chosen.definition.parameters ?? [];
  const planned = (
    params: Record<string, unknown>,
    pending: readonly PendingParameter[],
  ): StepResult =>
    ok({
      kind: 'planned',
      action: {
        instanceId: chosen.instance.instanceId,
        action: chosen.definition.name,
        params,
        pending,
      },
    });
  if (parameters.length === 0) return planned({}, []);

  const { slots, questions } = parameterQuestions(
    parameters,
    `param/${step}`,
    `For action ${step + 1}, ${chosen.definition.name} on ${chosen.instance.instanceId}`,
    intentText(request),
    enumSnapshotOf(request, ctx),
  );
  const reply = await ask(
    STAGE,
    {
      state: {
        intent: request.context.updateReasons,
        history: recentHistory(selection.input.history),
        previousActions: previous.map(({ instanceId, action, params }) => ({
          instanceId,
          action,
          params,
        })),
        action: {
          instanceId: chosen.instance.instanceId,
          variant: chosen.variant,
          definition: chosen.definition,
        },
      },
      questions,
    },
    ctx,
  );
  if (isErr(reply)) return err(reply.error);

  const choices: Record<string, string> = {};
  for (const slot of slots) {
    const answer = readAnswer(reply.value, slot.id, STAGE, ctx, policy);
    if (isErr(answer)) return answer;
    answers.push({ stage: STAGE, question: slot.id, ...answer.value });
    choices[slot.id] = answer.value.choice;
  }
  const bound = bindParameterChoices(slots, choices);
  const missing: ParameterAsk[] = bound.missing.map((parameter) => ({
    instanceId: chosen.instance.instanceId,
    action: chosen.definition.name,
    parameter,
  }));
  if (missing.length > 0) {
    ctx.logger.info('jev.action_dropped', {
      stage: STAGE,
      instanceId: chosen.instance.instanceId,
      action: chosen.definition.name,
      parameters: missing.map((entry) => entry.parameter.name),
    });
    return ok({ kind: 'dropped', asks: missing });
  }
  return planned(bound.params, bound.pending);
}
