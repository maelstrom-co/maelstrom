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
import type { AnyTextAdapter } from '@tanstack/ai';
import { STAGE_NAME } from './defer.js';
import { logTurns } from './log-turn.js';
import { FALLBACK_RETRIES } from './planners/jev-stage-planner.js';
import { jevActions } from './stages/jev-actions.js';
import { jevLayout } from './stages/jev-layout.js';
import { jevSelect } from './stages/jev-select.js';
import { llmComplete } from './stages/llm-complete.js';
import { createJevDeps, type JevDeps } from './stages/stage-deps.js';

export { FALLBACK_RETRIES };

/** Connection settings for TypeSafe's System One endpoint, which serves Jev. */
export interface TypeSafeOptions {
  /** TypeSafe API key. Keep it server-side; it is never logged or echoed in errors. */
  readonly apiKey: string;
  /** Pinned Jev model id, for example `jev-1.13.0`. `jev-latest` drifts. */
  readonly model: string;
  /** Endpoint URL. Defaults to TypeSafe's v1 System One endpoint. */
  readonly endpoint?: string;
  /** Per-call timeout in milliseconds, combined with the request's signal. Defaults to 5000. */
  readonly timeoutMs?: number;
  /** Transport. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * Logs at debug every raw Jev reply as `jev.reply`, and for each turn the
   * user's request as `jev.request` and the shipped candidate as
   * `jev.result`. For local debugging only. Defaults to `false`.
   */
  readonly logReplies?: boolean;
}

/** Configuration for {@link jevPlanner}. */
export interface JevPlannerOptions {
  /** How to reach Jev. */
  readonly typesafe: TypeSafeOptions;
  /** TanStack AI text adapter for the small completion call that writes the reply. */
  readonly adapter: AnyTextAdapter;
  /** Provider options forwarded to the completion call's `chat()`. */
  readonly modelOptions?: Record<string, unknown>;
  /**
   * Full planner that re-plans the request whenever a Jev stage defers, for
   * example `llmPlanner({ adapter })` from `@maelstrom-co/planner-llm`. Pass
   * it unwrapped: the planner wraps it in `withRetry` itself.
   */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/**
 * The frozen POC composition (select, actions, layout and the completion
 * call, with the LLM fallback) over `deps`, whose `ask` may be any
 * provider's client. Stages are named for `StageContext.instrument`.
 * {@link jevPlanner} is this with the TypeSafe client.
 */
export function buildJevPlanner(deps: JevDeps): Planner {
  return withFallback(
    pipeline(
      named(STAGE_NAME.jevSelect, jevSelect(deps.ask)),
      named(STAGE_NAME.jevActions, jevActions(deps.ask)),
      named(STAGE_NAME.jevLayout, jevLayout(deps.ask)),
      named(STAGE_NAME.llmComplete, llmComplete(deps.llm)),
    ),
    withRetry(deps.fallback, { max: FALLBACK_RETRIES }),
  );
}

/**
 * A tiling planner that lets TypeSafe's Jev model answer multiple-choice
 * questions for which instances to show, hide, delete or create, which
 * actions to run with which parameters, and which layout to use. One small
 * LLM call then writes the `userMessage`, fills parameter values the request
 * states in a form Jev could not pick, and asks the user for values it does
 * not state. Any deferral (grid mode, an unsupported or ambiguous request, a
 * TypeSafe failure or timeout, a candidate validation rejects) re-plans the
 * whole request with `fallback`, retried once on a recommended retry.
 *
 * Run the Engine with `retry: false` so the Jev pipeline is never re-run
 * whole: its last stage already checks the candidate and defers instead.
 * Do not wrap `fallback` in `withRetry`; this planner does.
 *
 * Experimental and server-only: the TypeSafe key must never reach a browser.
 *
 * @throws {Error} If an option is invalid. The message never contains the key.
 *
 * @example
 * ```ts
 * import { llmPlanner } from '@maelstrom-co/planner-llm';
 *
 * const engine = createEngine({
 *   planner: jevPlanner({
 *     typesafe: { apiKey: process.env.TYPESAFE_API_KEY, model: 'jev-1.13.0' },
 *     adapter,
 *     fallback: llmPlanner({ adapter }),
 *   }),
 *   retry: false,
 * });
 * ```
 */
export function jevPlanner(options: JevPlannerOptions): Planner {
  const planner = buildJevPlanner(createJevDeps(options));
  return options.typesafe.logReplies === true ? logTurns(planner) : planner;
}
