import type {
  ChartRequest,
  GridResponse,
  MaelstromResponse,
  MessageId,
  Result,
  SessionId,
  TilingResponse,
} from '@maelstrom-co/protocol';

import type { EngineError, ValidationError } from '../errors.js';
import { validationError } from '../errors.js';
import type { LLMContextMessage } from '../history/history-manager.js';
import type { Logger } from '../logger.js';
import type { EngineDiagnostics } from '../response/response-processor.js';

/**
 * What the Engine hands the first stage of a {@link Planner} for one
 * `chart_request`. Stages may pass a modified copy downstream (for example a
 * narrowed `request`), but the Engine always validates the final candidate
 * against the request it received, which stays available as
 * {@link StageContext.origin}.
 */
export interface PlanningInput {
  /** Envelope id of the `chart_request`, for correlating stage logs with Engine logs. */
  readonly messageId: MessageId;
  /** Session the request belongs to; the key for any per-session state a stage keeps. */
  readonly sessionId: SessionId;
  /** Chart state, Vessel catalog and update reasons as the client sent them. */
  readonly request: ChartRequest;
  /** Prior conversation as projected by the Engine's history config. Empty without history. */
  readonly history: readonly LLMContextMessage[];
}

/**
 * The raw plan a {@link Planner} produces: the structured output shape for the
 * request's layout mode, before the Engine heals and validates it. A grid
 * request expects a `GridResponse`; a tiling request a `TilingResponse`.
 */
export type PlannerCandidate = GridResponse | TilingResponse;

/**
 * A stage abstaining from the request. Deferral is a value in the error
 * channel, never a thrown exception, and is distinct from every
 * {@link EngineError} so that {@link withFallback} can recover from it alone.
 */
export interface Deferred {
  /** Discriminator shared with the `EngineError` variants. */
  readonly _tag: 'Deferred';
  /** Why the stage abstained, for logs. */
  readonly reason: string;
}

/** Failure channel of a {@link Stage}: abstain, or fail with an Engine error. */
export type StageError = Deferred | EngineError;

/**
 * Candidate after the Engine healed and validated it against the original
 * request: the response that would ship, plus the diagnostics describing what
 * healing changed. The diagnostics never cross the Engine boundary.
 */
export type ValidatedCandidate = MaelstromResponse & {
  /** What healing dropped, skipped or repaired, and whether a retry is recommended. */
  readonly diagnostics: EngineDiagnostics;
};

/**
 * Heals and validates a candidate against the original request, the same way
 * the Engine validates the candidate it ships. Results are cached per
 * candidate object for the request, so validating inside a stage costs
 * nothing extra when the same candidate reaches the Engine. A failure that
 * healing cannot absorb (for example a missing `userMessage`) is an `Err`;
 * nothing throws.
 */
export type ValidateCandidate = (
  candidate: PlannerCandidate,
) => Result<ValidatedCandidate, EngineError>;

/** Request-scoped services the Engine gives every stage of a {@link Planner}. */
export interface StageContext {
  /**
   * Cancels in-flight work for the request. Every stage must honour it so
   * that cancelled requests, and later concurrent combinators, stop spending
   * on work nobody will use.
   */
  readonly signal?: AbortSignal;
  /** The Engine's logger. Log through it so stage logs share the Engine's sink and redaction. */
  readonly logger: Logger;
  /** The untouched input the Engine passed to the first stage. */
  readonly origin: PlanningInput;
  /** Heals and validates a candidate against the request in {@link StageContext.origin}. */
  readonly validate: ValidateCandidate;
}

/**
 * One step of a plan. A stage takes its input and the request context and
 * resolves to its output, a {@link Deferred}, or an {@link EngineError}. It
 * must not reject: failures belong in the `Result`.
 *
 * @typeParam In - What the previous stage produced (or {@link PlanningInput} for the first stage).
 * @typeParam Out - What the next stage consumes (or {@link PlannerCandidate} for the last stage).
 */
export type Stage<In, Out> = (
  input: In,
  ctx: StageContext,
) => Promise<Result<Out, StageError>>;

/**
 * A complete plan for one `chart_request`: a stage from the Engine's input
 * to a candidate it can validate. Only these two ends are fixed; the types
 * between stages belong to whoever composes them with {@link pipeline}.
 *
 * One planner serves every session and concurrent request of an Engine, so
 * any state it keeps across calls must be keyed by the request (or session)
 * and safe under concurrent calls. State from one request must never affect
 * another; a per-request cache belongs in a `WeakMap` keyed by
 * `input.request`, for example.
 */
export type Planner = Stage<PlanningInput, PlannerCandidate>;

/**
 * Why the previous attempt of a {@link withRetry}-wrapped stage was rejected.
 * Present only on retries.
 */
export interface RetryFeedback {
  /** Retry number: 1 for the first retry. */
  readonly attempt: number;
  /** The candidate the previous attempt produced. */
  readonly previous: PlannerCandidate;
  /** Heal diagnostics for {@link previous}, which recommended the retry. */
  readonly diagnostics: EngineDiagnostics;
}

/**
 * A stage input that {@link withRetry} may annotate with feedback about the
 * previous attempt. `retry` is absent on the first attempt.
 */
export type Retryable<In> = In & {
  /** Feedback about the previous attempt; absent on the first attempt. */
  readonly retry?: RetryFeedback;
};

/**
 * Creates a {@link Deferred}.
 *
 * @param reason - Why the stage abstained, for logs.
 */
export function deferred(reason: string): Deferred {
  return { _tag: 'Deferred', reason };
}

/** Narrows a stage failure to a {@link Deferred}. */
export function isDeferred(error: StageError): error is Deferred {
  return error._tag === 'Deferred';
}

/**
 * The error the Engine reports when a planner defers and nothing handled the
 * deferral: a `ValidationError` on field `'planner'`. The Engine cannot ship
 * a response without a `userMessage`, so an unhandled deferral fails the
 * request.
 */
export function unhandledDeferralError(error: Deferred): ValidationError {
  return validationError(`planner deferred: ${error.reason}`, 'planner');
}
