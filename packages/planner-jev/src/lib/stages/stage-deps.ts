import type {
  PlannerCandidate,
  PlanningInput,
  Retryable,
  Stage,
} from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';

import type { Ask } from '../ask.js';
import { createStageDeps } from '../planners/jev-stage-planner.js';
import {
  createTypeSafeClient,
  type TypeSafeClientOptions,
} from '../typesafe-client.js';

/** The completion call's provider settings. */
export interface CompletionLlm {
  readonly adapter: AnyTextAdapter;
  readonly modelOptions?: Record<string, unknown>;
}

/** What every planner builder composes its stages from. */
export interface JevDeps {
  readonly ask: Ask;
  readonly llm: CompletionLlm;
  /** The unwrapped fallback planner; builders wrap it in `withRetry`. */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/** Options {@link createJevDeps} builds {@link JevDeps} from, shaped like `JevPlannerOptions`. */
export interface JevDepsOptions {
  readonly typesafe: TypeSafeClientOptions;
  readonly adapter: AnyTextAdapter;
  readonly modelOptions?: Record<string, unknown>;
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/**
 * Validates `options` and creates the TypeSafe client once.
 *
 * @throws {Error} If `fallback` is not a stage or `adapter` is missing.
 */
export function createJevDeps(options: JevDepsOptions): JevDeps {
  return createStageDeps(
    createTypeSafeClient(options.typesafe),
    options,
    'JevPlannerOptions',
  );
}
