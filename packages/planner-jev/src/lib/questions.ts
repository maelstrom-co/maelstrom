import type {
  Deferred,
  LLMContextMessage,
  StageContext,
} from '@maelstrom-co/engine';
import { type ChartRequest, ok, type Result } from '@maelstrom-co/protocol';

import { deferAt, type StageName } from './defer.js';

/** TypeSafe rejects a choice question with more options than this. */
export const MAX_CHOICES = 255;

const HISTORY_MESSAGES = 6;

/** One multiple-choice question: the option keys are the criteria's keys. */
export interface Question {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

/** One TypeSafe request: shared state plus the questions to answer about it. */
export interface Evaluation {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}

/** Jev's pick for one question. */
export interface Answer {
  readonly choice: string;
  readonly confidence: number;
}

/** Token usage TypeSafe reports for one call. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** A validated TypeSafe reply. */
export interface Reply {
  readonly answers: Readonly<Record<string, Answer>>;
  readonly usage: Usage;
}

/** Optional gate on consumed answers. Unset by default: confidence is uncalibrated. */
export interface ConfidencePolicy {
  /** Defer when a consumed answer's confidence is below this inclusive minimum in [0, 1]. */
  readonly minimum?: number;
}

export function choice(
  instructions: string,
  criteria: Readonly<Record<string, string>>,
): Question {
  return { type: 'choice', instructions, criteria };
}

/** The id of the first question over {@link MAX_CHOICES} options, if any. */
export function overOptionCap(evaluation: Evaluation): string | undefined {
  return Object.entries(evaluation.questions).find(
    ([, question]) => Object.keys(question.criteria).length > MAX_CHOICES,
  )?.[0];
}

/**
 * Reads one answer from a reply, logging `jev.answer` at debug, and applies
 * the optional confidence gate.
 */
export function readAnswer(
  reply: Reply,
  id: string,
  stage: StageName,
  ctx: StageContext,
  policy: ConfidencePolicy = {},
): Result<Answer, Deferred> {
  const answer = reply.answers[id];
  if (answer === undefined) return deferAt(ctx, stage, 'answer_missing', id);
  ctx.logger.debug('jev.answer', {
    stage,
    question: id,
    choice: answer.choice,
    confidence: answer.confidence,
  });
  if (policy.minimum !== undefined && answer.confidence < policy.minimum)
    return deferAt(ctx, stage, 'low_confidence', id);
  return ok(answer);
}

/**
 * Whether the request carries only `chart_resize` reasons. A request with no
 * reasons at all is not resize-only.
 */
export function isResizeOnly(request: ChartRequest): boolean {
  const reasons = request.context.updateReasons;
  return (
    reasons.length > 0 &&
    reasons.every((reason) => reason.type === 'chart_resize')
  );
}

/** The user's words in this request, one line per `user_intent` reason. */
export function intentText(request: ChartRequest): string {
  return request.context.updateReasons
    .flatMap((reason) => (reason.type === 'user_intent' ? [reason.intent] : []))
    .join('\n');
}

/** The last few history messages, enough to resolve a follow-up. */
export function recentHistory(
  history: readonly LLMContextMessage[],
): readonly LLMContextMessage[] {
  return history.slice(-HISTORY_MESSAGES);
}
