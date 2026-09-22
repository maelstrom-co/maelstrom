import type {
  CancellationError,
  Deferred,
  StageContext,
} from '@maelstrom-co/engine';
import {
  type InstanceId,
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
  type ChoiceQuestion,
  choice,
  intentText,
  isResizeOnly,
  type Question,
  type Reply,
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
import type { ActionPlan2, ActionsStage, Selection2 } from './types.js';

const STAGE = 'jevActions';

/** Questions the first call of {@link batchedActions} asks at most. */
export const MAX_BATCH_QUESTIONS = 48;

export interface BatchedActionsOptions {
  readonly maxQuestions?: number;
}

/**
 * Plans the ordered actions in two calls. The first asks the next action
 * for every variant state the request can reach, depth by depth up to
 * {@link MAX_ACTIONS}, keyed by state rather than by the actions that led
 * there, while the questions fit `maxQuestions`; code walks the answers
 * from the current state and any remaining depth is asked one call per
 * step. The second binds every chosen action's parameters at once. A
 * resize-only request, or a `needsActions` gate answering no, plans no
 * actions and makes no call.
 */
export function batchedActions(
  ask: Ask,
  options: BatchedActionsOptions = {},
): ActionsStage {
  const maxQuestions = options.maxQuestions ?? MAX_BATCH_QUESTIONS;
  return async (selection, ctx) => {
    const { request } = selection.input;
    const retained = selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    if (isResizeOnly(request) || selection.gates?.needsActions?.answer === 'no')
      return ok(actionPlanOf(selection, [], [], []));

    const initial: Variants = new Map(
      retained.map((instance) => [instance.instanceId, instance.variant]),
    );
    const levels = speculativeLevels(retained, initial, request, maxQuestions);
    if (levels.length === 0) return deferAt(ctx, STAGE, 'batch_cap');

    const questions: Record<string, Question> = {};
    for (const [depth, level] of levels.entries())
      for (const node of level.values())
        questions[node.id] = actionQuestion(depth, node, initial);
    const state = {
      intent: request.context.updateReasons,
      history: recentHistory(selection.input.history),
      instances: retained.map((instance) => ({
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
        variant: instance.variant,
        visible: instance.visible,
      })),
    };
    const batch = await ask(STAGE, { state, questions }, ctx);
    if (isErr(batch)) return batch;

    const answers: AnswerRecord[] = [];
    const chosen: StateOption[] = [];
    let variants: Variants = initial;
    for (let step = 0; ; step++) {
      const key = stateKey(variants, initial);
      let node = levels[step]?.get(key);
      let reply: Reply = batch.value;
      if (node === undefined) {
        node = stateNode(step, key, variants, retained, request);
        const single = await ask(
          STAGE,
          {
            state: {
              ...state,
              previousActions: chosen.map((option) => ({
                instanceId: option.instance.instanceId,
                action: option.definition.name,
              })),
            },
            questions: { [node.id]: actionQuestion(step, node, initial) },
          },
          ctx,
        );
        if (isErr(single)) return single;
        reply = single.value;
      }
      const answer = readAnswer(reply, node.id, STAGE, ctx);
      if (isErr(answer)) return answer;
      answers.push({ stage: STAGE, question: node.id, ...answer.value });
      if (answer.value.choice === 'done') break;
      if (answer.value.choice === 'unsupported')
        return deferAt(ctx, STAGE, 'action_unsupported', node.id);
      if (step === MAX_ACTIONS)
        return deferAt(ctx, STAGE, 'action_limit', node.id);
      const option = node.options.find(
        (candidate) => candidate.key === answer.value.choice,
      );
      if (!option) return deferAt(ctx, STAGE, 'answer_missing', node.id);
      chosen.push(option);
      variants = afterAction(variants, option);
    }

    const bound = await bindChosen(ask, selection, chosen, answers, ctx);
    if (isErr(bound)) return bound;
    const simulated = finalVariants(
      retained,
      bound.value.actions,
      request.vessels,
    );
    if (isErr(simulated)) return deferAt(ctx, STAGE, 'simulation_failed');
    return ok(
      actionPlanOf(selection, bound.value.actions, bound.value.asks, answers),
    );
  };
}

type Variants = ReadonlyMap<InstanceId, VariantName>;

interface StateOption {
  readonly key: string;
  readonly instance: SelectedInstance;
  readonly variant: VariantName;
  readonly definition: VesselAction;
}

interface StateNode {
  readonly id: string;
  readonly variants: Variants;
  readonly options: readonly StateOption[];
}

function speculativeLevels(
  retained: readonly SelectedInstance[],
  initial: Variants,
  request: Selection2['input']['request'],
  maxQuestions: number,
): ReadonlyMap<string, StateNode>[] {
  const levels: Map<string, StateNode>[] = [];
  let frontier = new Map([
    [
      stateKey(initial, initial),
      stateNode(0, 'same', initial, retained, request),
    ],
  ]);
  let asked = 0;
  for (let depth = 0; depth <= MAX_ACTIONS; depth++) {
    if (asked + frontier.size > maxQuestions) break;
    asked += frontier.size;
    levels.push(frontier);
    const next = new Map<string, StateNode>();
    for (const node of frontier.values())
      for (const option of node.options) {
        const variants = afterAction(node.variants, option);
        const key = stateKey(variants, initial);
        if (!next.has(key))
          next.set(key, stateNode(depth + 1, key, variants, retained, request));
      }
    frontier = next;
  }
  return levels;
}

function stateNode(
  depth: number,
  key: string,
  variants: Variants,
  retained: readonly SelectedInstance[],
  request: Selection2['input']['request'],
): StateNode {
  const options: StateOption[] = [];
  for (const instance of retained) {
    const variant = variants.get(instance.instanceId) ?? instance.variant;
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
  return {
    id: depth === 0 ? 'action/0' : `action/${depth}@${key}`,
    variants,
    options,
  };
}

function actionQuestion(
  depth: number,
  node: StateNode,
  initial: Variants,
): ChoiceQuestion {
  const criteria: Record<string, string> = {
    done: 'Every requested view change and content edit is already planned, or none was requested. Showing, hiding or arranging widgets needs no action.',
    unsupported:
      'A remaining requested view change or content edit cannot be performed with these actions.',
  };
  for (const option of node.options)
    criteria[option.key] =
      `${option.instance.instanceId}, currently ${option.variant}: ${option.definition.name}. ${option.definition.description}${option.definition.transitionsTo ? ` Switches it to its ${option.definition.transitionsTo} view.` : ''}`;
  const rule =
    'A view change is an action: choose the action that switches to the requested view. Showing, hiding or arranging widgets needs no action.';
  if (depth === 0)
    return choice(
      `Choose the first action the latest intent requests, in the order the user asked for them. ${rule} Choose done when it requests no view change or content edit.`,
      criteria,
    );
  return choice(
    `Suppose the first ${depth} actions the latest intent requests, in the order the user asked for them, have already run, leaving ${describeViews(node.variants, initial)}. Choose action ${depth + 1} the latest intent requests. ${rule} Choose done when it requests ${depth} actions or fewer.`,
    criteria,
  );
}

async function bindChosen(
  ask: Ask,
  selection: Selection2,
  chosen: readonly StateOption[],
  answers: AnswerRecord[],
  ctx: StageContext,
): Promise<
  Result<
    { readonly actions: PlannedAction[]; readonly asks: ParameterAsk[] },
    Deferred | CancellationError
  >
> {
  const { request } = selection.input;
  const intent = intentText(request);
  const snapshot = enumSnapshotOf(request, ctx);
  const built = chosen.map((option, index) =>
    parameterQuestions(
      option.definition.parameters ?? [],
      `param/${index}`,
      `For action ${index + 1}, ${option.definition.name} on ${option.instance.instanceId}`,
      intent,
      snapshot,
    ),
  );
  const questions = Object.assign({}, ...built.map((b) => b.questions));
  const choices: Record<string, string> = {};
  if (Object.keys(questions).length > 0) {
    const reply = await ask(
      STAGE,
      {
        state: {
          intent: request.context.updateReasons,
          history: recentHistory(selection.input.history),
          actions: chosen.map((option) => ({
            instanceId: option.instance.instanceId,
            variant: option.variant,
            definition: option.definition,
          })),
        },
        questions,
      },
      ctx,
    );
    if (isErr(reply)) return reply;
    for (const { slots } of built)
      for (const slot of slots) {
        const answer = readAnswer(reply.value, slot.id, STAGE, ctx);
        if (isErr(answer)) return answer;
        answers.push({ stage: STAGE, question: slot.id, ...answer.value });
        choices[slot.id] = answer.value.choice;
      }
  }
  const actions: PlannedAction[] = [];
  const asks: ParameterAsk[] = [];
  chosen.forEach((option, index) => {
    const bound = bindParameterChoices(built[index]?.slots ?? [], choices);
    const target = {
      instanceId: option.instance.instanceId,
      action: option.definition.name,
    };
    if (bound.missing.length === 0)
      actions.push({ ...target, params: bound.params, pending: bound.pending });
    else
      asks.push(
        ...bound.missing.map((parameter) => ({ ...target, parameter })),
      );
  });
  return ok({ actions, asks });
}

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

function afterAction(variants: Variants, option: StateOption): Variants {
  const target = option.definition.transitionsTo;
  if (target === undefined) return variants;
  return new Map(variants).set(option.instance.instanceId, target);
}

function stateKey(variants: Variants, initial: Variants): string {
  const changed = [...variants]
    .filter(([id, variant]) => initial.get(id) !== variant)
    .map(([id, variant]) => `${id}:${variant}`)
    .sort();
  return changed.length === 0 ? 'same' : changed.join(',');
}

function describeViews(variants: Variants, initial: Variants): string {
  const changed = [...variants].filter(
    ([id, variant]) => initial.get(id) !== variant,
  );
  if (changed.length === 0) return 'every instance in its current view';
  return `${changed.map(([id, variant]) => `${id} in its ${variant} view`).join(', ')} and every other instance in its current view`;
}
