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

import { STAGE_NAME } from '../defer.js';
import { logTurns } from '../log-turn.js';
import { createDecisionsClient } from '../openai-decisions-client.js';
import { jevActions } from '../stages/jev-actions.js';
import { jevLayout } from '../stages/jev-layout.js';
import { jevSelect } from '../stages/jev-select.js';
import { llmComplete } from '../stages/llm-complete.js';
import type { JevDeps } from '../stages/stage-deps.js';
import { createStageDeps, FALLBACK_RETRIES } from './jev-stage-planner.js';

/** Connection settings for OpenAI's Decisions endpoint. */
export interface DecisionsOptions {
  /** OpenAI API key. Keep it server-side; it is never logged or echoed in errors. */
  readonly apiKey: string;
  /** Decisions model id. Defaults to `gpt-6-luna`. */
  readonly model?: string;
  /** Endpoint URL. Defaults to OpenAI's v1 Decisions endpoint. */
  readonly endpoint?: string;
  /** Per-call timeout in milliseconds, combined with the request's signal. Defaults to 5000. */
  readonly timeoutMs?: number;
  /** Transport. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * Logs at debug every raw Decisions reply as `jev.reply`, and for each
   * turn the user's request as `jev.request` and the shipped candidate as
   * `jev.result`. For local debugging only. Defaults to `false`.
   */
  readonly logReplies?: boolean;
}

/** Configuration for {@link decisionsPlanner} and `decisionsComposedPairsPlanner`. */
export interface DecisionsPlannerOptions {
  /** How to reach OpenAI Decisions. */
  readonly decisions: DecisionsOptions;
  /** TanStack AI text adapter for the small completion call that writes the reply. */
  readonly adapter: AnyTextAdapter;
  /** Provider options forwarded to the completion call's `chat()`. */
  readonly modelOptions?: Record<string, unknown>;
  /**
   * Full planner that re-plans the request whenever a stage defers, for
   * example `llmPlanner({ adapter })` from `@maelstrom-co/planner-llm`. Pass
   * it unwrapped: the planner wraps it in `withRetry` itself.
   */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/**
 * Builds the POC composition (select, actions, layout and the completion
 * call, with the LLM fallback) over `deps`, whose `ask` may be any
 * provider. Stages are named for `StageContext.instrument`.
 * {@link decisionsPlanner} is this with the Decisions client.
 */
export function buildDecisionsPlanner(deps: JevDeps): Planner {
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
 * Experimental tiling planner that asks OpenAI's Decisions API the same
 * typed questions `jevPlanner` asks TypeSafe Jev: which instances to show,
 * hide, delete or create, which actions to run with which parameters, and
 * which layout to use. One small LLM call then writes the `userMessage` as
 * in `jevPlanner`. Any deferral (grid mode, an unsupported or ambiguous
 * request, a Decisions refusal, failure or timeout, a candidate validation
 * rejects) re-plans the whole request with `fallback`, retried once on a
 * recommended retry. Needs only an OpenAI key; no TypeSafe key.
 *
 * Run the Engine with `retry: false` so the pipeline is never re-run
 * whole: its last stage already checks the candidate and defers instead.
 * Do not wrap `fallback` in `withRetry`; this planner does.
 *
 * Server-only: the OpenAI key must never reach a browser.
 *
 * @experimental
 * @throws {Error} If an option is invalid. The message never contains the key.
 *
 * @example
 * ```ts
 * import { llmPlanner } from '@maelstrom-co/planner-llm';
 *
 * const engine = createEngine({
 *   planner: decisionsPlanner({
 *     decisions: { apiKey: process.env.OPENAI_API_KEY },
 *     adapter,
 *     fallback: llmPlanner({ adapter }),
 *   }),
 *   retry: false,
 * });
 * ```
 */
export function decisionsPlanner(options: DecisionsPlannerOptions): Planner {
  const planner = buildDecisionsPlanner(
    createStageDeps(
      createDecisionsClient(options.decisions),
      options,
      'DecisionsPlannerOptions',
    ),
  );
  return options.decisions.logReplies === true ? logTurns(planner) : planner;
}
