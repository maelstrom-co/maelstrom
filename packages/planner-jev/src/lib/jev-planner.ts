import {
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

import type { StageName } from './defer.js';
import { jevActions } from './stages/jev-actions.js';
import { jevLayout } from './stages/jev-layout.js';
import { jevSelect } from './stages/jev-select.js';
import { llmComplete } from './stages/llm-complete.js';
import {
  createTypeSafeClient,
  type TypeSafeClientOptions,
} from './typesafe-client.js';

/** How many times the fallback is re-run when validation recommends a retry. */
export const FALLBACK_RETRIES = 1;

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
   * example `llmPlanner({ adapter })`. Pass it unwrapped: the planner wraps
   * it in `withRetry` itself.
   */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/** Wraps each stage of the composition, for instrumentation. */
export type Instrument = <In, Out>(
  name: StageName,
  stage: Stage<In, Out>,
) => Stage<In, Out>;

/**
 * Builds the composition with an instrumentation hook and the TypeSafe
 * client's call hook. {@link jevPlanner} is this without instrumentation.
 */
export function buildJevPlanner(
  options: Omit<JevPlannerOptions, 'typesafe'> & {
    readonly typesafe: TypeSafeClientOptions;
  },
  instrument: Instrument = (_name, stage) => stage,
): Planner {
  if (typeof options.fallback !== 'function')
    throw new Error('Invalid JevPlannerOptions: fallback must be a stage');
  if (options.adapter === undefined || options.adapter === null)
    throw new Error('Invalid JevPlannerOptions: adapter is required');
  const ask = createTypeSafeClient(options.typesafe);
  return withFallback(
    pipeline(
      instrument('jevSelect', jevSelect(ask)),
      instrument('jevActions', jevActions(ask)),
      instrument('jevLayout', jevLayout(ask)),
      instrument(
        'llmComplete',
        llmComplete({
          adapter: options.adapter,
          ...(options.modelOptions !== undefined && {
            modelOptions: options.modelOptions,
          }),
        }),
      ),
    ),
    withRetry(options.fallback, { max: FALLBACK_RETRIES }),
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
  return buildJevPlanner(options);
}
