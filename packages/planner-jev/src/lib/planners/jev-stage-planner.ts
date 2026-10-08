import {
  named,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  pipeline,
  type Retryable,
  type Stage,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';
import { isErr, ok } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import type { Ask } from '../ask.js';
import { STAGE_NAME } from '../defer.js';
import type { CompletionLlm, JevDeps } from '../stages/stage-deps.js';
import type {
  ActionPlan2,
  ActionsStage,
  CompleteStage,
  LayoutDecision,
  Selection2,
} from '../stages/stage-types.js';

/** How many times the fallback is re-run when validation recommends a retry. */
export const FALLBACK_RETRIES = 1;

/** The provider-neutral options {@link createStageDeps} validates, shaped like `JevPlannerOptions`. */
export interface StageDepsOptions {
  /** TanStack AI text adapter for the completion call. */
  readonly adapter: AnyTextAdapter;
  /** Provider options forwarded to the completion call's `chat()`. */
  readonly modelOptions?: Record<string, unknown>;
  /** The unwrapped fallback planner. */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/**
 * Validates the provider-neutral options and assembles {@link JevDeps}
 * around `ask`. Error messages start with `Invalid ${optionsName}:`.
 *
 * @throws {Error} If `fallback` is not a stage or `adapter` is missing.
 */
export function createStageDeps(
  ask: Ask,
  options: StageDepsOptions,
  optionsName: string,
): JevDeps {
  if (typeof options.fallback !== 'function')
    throw new Error(`Invalid ${optionsName}: fallback must be a stage`);
  if (options.adapter === undefined || options.adapter === null)
    throw new Error(`Invalid ${optionsName}: adapter is required`);
  return {
    ask,
    llm: {
      adapter: options.adapter,
      ...(options.modelOptions !== undefined && {
        modelOptions: options.modelOptions,
      }),
    },
    fallback: options.fallback,
  };
}

/**
 * The action plan an actions stage hands on after a select stage whose
 * output is `Selected`: the plan keeps the selection's gates, required when
 * the select stage always asks them.
 */
export type ActionPlanAfter<Selected extends Selection2> = ActionPlan2 &
  Pick<Selected, 'gates'>;

/**
 * One stage factory per pipeline slot. The layout factory's input is typed
 * by the select stage's output, so a layout stage that routes on the gates
 * (`layoutComposedPairsGateAndDefer`) only compiles after `selectGated`.
 */
export interface JevStages<Selected extends Selection2> {
  readonly select: (ask: Ask) => Stage<PlanningInput, Selected>;
  readonly actions: (ask: Ask) => ActionsStage;
  readonly layout: (
    ask: Ask,
  ) => Stage<ActionPlanAfter<Selected>, LayoutDecision>;
  readonly complete: (llm: CompletionLlm) => CompleteStage;
}

/**
 * A stage-library planner from one factory per slot: select, actions,
 * layout and completion, with the LLM fallback. Stages keep the POC's
 * names for `StageContext.instrument`, so it records and replays them alike.
 */
export function buildJevStagePlanner<Selected extends Selection2>(
  stages: JevStages<Selected>,
  deps: JevDeps,
): Planner {
  return withFallback(
    pipeline(
      named(STAGE_NAME.jevSelect, stages.select(deps.ask)),
      named(
        STAGE_NAME.jevActions,
        keepingGates<Selected>(stages.actions(deps.ask)),
      ),
      named(STAGE_NAME.jevLayout, stages.layout(deps.ask)),
      named(STAGE_NAME.llmComplete, stages.complete(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}

/** Every actions stage forwards the selection's gates; this states it in the type. */
function keepingGates<Selected extends Selection2>(
  actions: ActionsStage,
): Stage<Selected, ActionPlanAfter<Selected>> {
  return async (selection, ctx) => {
    const result = await actions(selection, ctx);
    if (isErr(result)) return result;
    return ok({
      ...result.value,
      ...(selection.gates !== undefined && { gates: selection.gates }),
    } as ActionPlanAfter<Selected>);
  };
}
