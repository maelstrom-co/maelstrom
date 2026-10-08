import type {
  CancellationError,
  Deferred,
  StageContext,
} from '@maelstrom-co/engine';
import type { Result } from '@maelstrom-co/protocol';

import type { JevCaller } from './defer.js';
import type { Answer, Evaluation, Reply, Usage } from './questions.js';

/**
 * How one provider call ended: `ok`, `cancelled`, or the deferral code.
 * `provider_refusal` is an OpenAI Decisions refusal of a question; TypeSafe
 * never refuses.
 */
export type CallOutcome =
  | 'ok'
  | 'cancelled'
  | 'option_cap'
  | 'provider_timeout'
  | 'provider_network'
  | 'provider_http'
  | 'provider_invalid_reply'
  | 'provider_refusal';

/** One validated answer as {@link AskCall} reports it. */
export interface CallAnswer extends Answer {
  /** Probability per option: `yes` and `no` for a noul, level number strings for a score. */
  readonly probabilities?: Readonly<Record<string, number>>;
}

/** What a provider client reports about each call to its `onCall` hook. */
export interface AskCall {
  /** Who asked: a stage, or `grader` for the eval's grader. */
  readonly stage: JevCaller;
  /** The ids of the questions asked, in the evaluation's order. */
  readonly questionIds: readonly string[];
  /** Wall time from the start of the call to its outcome, in milliseconds. */
  readonly latencyMs: number;
  /** Token usage the provider reported; absent when the call failed. */
  readonly usage?: Usage;
  /** How the call ended. */
  readonly outcome: CallOutcome;
  /** Every answer of a reply that passed validation, whether or not the stage later defers. */
  readonly answers?: Readonly<Record<string, CallAnswer>>;
}

/** Asks the provider one evaluation on behalf of `stage`, a stage or the eval's grader. */
export type Ask = (
  stage: JevCaller,
  evaluation: Evaluation,
  ctx: StageContext,
) => Promise<Result<Reply, Deferred | CancellationError>>;
