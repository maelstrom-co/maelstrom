import type {
  Deferred,
  LLMContextMessage,
  StageContext,
} from '@maelstrom-co/engine';
import { type ChartRequest, ok, type Result } from '@maelstrom-co/protocol';

import { deferAt, type StageName } from './defer.js';

/** TypeSafe rejects a choice question with more options than this. */
export const MAX_CHOICES = 255;

/** The fewest levels a score question may have. */
export const MIN_LEVELS = 2;

/** The most levels a score question may have. */
export const MAX_LEVELS = 10;

const HISTORY_MESSAGES = 6;

/** Any JSON value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Instructions or an option description: plain text, or a JSON object
 * TypeSafe reads as structured text, such as
 * `{ "what": ..., "not_for": ..., "examples": [...] }` for options that are
 * easily confused.
 */
export type QuestionText = string | { readonly [key: string]: JsonValue };

/** One multiple-choice question: the option keys are the criteria's keys. */
export interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: QuestionText;
  readonly criteria: Readonly<Record<string, QuestionText>>;
}

/** One yes/no question; the reply is the probability of yes. */
export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions: string;
}

/**
 * One question rated on an ordered scale. TypeSafe's wire name for the
 * levels is `criteria`, an array here rather than a choice's option map.
 */
export interface ScoreQuestion {
  readonly type: 'score';
  readonly instructions: string;
  /** Descriptive levels, lowest first; level `i` is the i-th entry. */
  readonly criteria: readonly string[];
}

/** Any question TypeSafe answers: a choice, a yes/no noul or a score. */
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

/** One TypeSafe request: shared state plus the questions to answer about it. */
export interface Evaluation {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}

/**
 * Jev's pick for one question. A noul answer picks `yes` when its
 * probability of yes is at least one half, and its confidence is how far
 * that probability is from one half, scaled to [0, 1]. A score answer picks
 * its most probable level as a level number string (`"0"` is the lowest; a
 * tie picks the lower level) and keeps TypeSafe's confidence.
 */
export interface Answer {
  readonly choice: string;
  readonly confidence: number;
  /** The probability of yes; noul answers only. */
  readonly probability?: number;
  /** The fractional position along the levels, from 0 to levels - 1; score answers only. */
  readonly score?: number;
  /**
   * Probability per option, keyed by option key for a choice answer and by
   * level number string for a score answer; absent on noul answers, which
   * carry {@link probability}. On a choice answer in a {@link Reply} it is a
   * non-enumerable property: read it directly, since spreading the answer or
   * serialising it to JSON leaves it out.
   */
  readonly probabilities?: Readonly<Record<string, number>>;
}

/** The answer to a score question: an {@link Answer} with its score and per-level probabilities. */
export interface ScoreAnswer extends Answer {
  readonly score: number;
  readonly probabilities: Readonly<Record<string, number>>;
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

/** A multiple-choice question over `criteria`, option key to description. */
export function choice(
  instructions: QuestionText,
  criteria: Readonly<Record<string, QuestionText>>,
): ChoiceQuestion {
  return { type: 'choice', instructions, criteria };
}

/** A yes/no question answered with the probability of yes. */
export function noul(instructions: string): NoulQuestion {
  return { type: 'noul', instructions };
}

/**
 * A question rated on `levels`, ordered descriptive levels, lowest first.
 * Describe each level in words: numeric-only level text rates poorly.
 *
 * @throws RangeError when there are fewer than {@link MIN_LEVELS} or more
 * than {@link MAX_LEVELS} levels.
 */
export function score(
  instructions: string,
  levels: readonly string[],
): ScoreQuestion {
  if (levels.length < MIN_LEVELS || levels.length > MAX_LEVELS)
    throw new RangeError(
      `A score question needs ${MIN_LEVELS} to ${MAX_LEVELS} levels, got ${levels.length}`,
    );
  return { type: 'score', instructions, criteria: [...levels] };
}

/** Whether `answer` answers a score question. */
export function isScoreAnswer(answer: Answer): answer is ScoreAnswer {
  return answer.score !== undefined && answer.probabilities !== undefined;
}

/** The id of the first question over {@link MAX_CHOICES} options, if any. */
export function overOptionCap(evaluation: Evaluation): string | undefined {
  return Object.entries(evaluation.questions).find(
    ([, question]) =>
      question.type === 'choice' &&
      Object.keys(question.criteria).length > MAX_CHOICES,
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
