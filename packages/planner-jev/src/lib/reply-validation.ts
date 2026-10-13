import { err, isOk, ok, type Result } from '@maelstrom-co/protocol';

import type { CallAnswer } from './ask.js';
import type { Answer, Evaluation, Question, Reply } from './questions.js';

/**
 * Why a provider reply failed validation, one tag per check:
 * - `oversize`: the body exceeds 256 KB by its declared length or while streaming
 * - `malformed_json`: the body is not JSON, or the reply or an answer lacks a
 *   field or has a field of the wrong shape, such as missing answers, a
 *   non-numeric value or usage that is not a non-negative integer
 * - `wrong_type`: an answer kind does not match its question's kind
 * - `out_of_range`: a confidence or probability outside [0, 1], or a score
 *   outside its levels
 * - `missing_answer`: an asked question has no answer
 * - `key_mismatch`: an answer to or a refusal of a question that was not
 *   asked, a chosen option or a probability key outside the question's
 *   options or levels, or a score legend that does not echo the levels in
 *   order
 * - `probability_sum`: the probabilities do not sum to one within 0.02
 * - `not_most_probable`: the chosen option is not the most probable one
 * - `model_echo`: the reply echoes a different model than the one asked
 */
export type InvalidReplyReason =
  | 'oversize'
  | 'malformed_json'
  | 'wrong_type'
  | 'out_of_range'
  | 'missing_answer'
  | 'key_mismatch'
  | 'probability_sum'
  | 'not_most_probable'
  | 'model_echo';

/** Whether `value` is a plain object, not `null` and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `record` has exactly `keys` as its own keys. */
export function sameKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key))
  );
}

/** Whether `value` is a finite number in [0, 1]. */
export function isProbability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/** Whether `value` is a non-negative safe integer, such as a token count. */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A noul answer from the probability of yes: `yes` from one half up, with
 * its distance from one half scaled to [0, 1] as the confidence.
 */
export function noulAnswer(probability: number): CallAnswer {
  return {
    choice: probability >= 0.5 ? 'yes' : 'no',
    confidence: Math.abs(2 * probability - 1),
    probability,
    probabilities: { yes: probability, no: 1 - probability },
  };
}

/**
 * A choice answer once a provider's wire format is normalised, or the reason
 * it is invalid: `choice` must be one of `options`, `confidence` a
 * probability, `probabilities` must cover exactly `options` with
 * probabilities summing to one, and `choice` must have the highest of them
 * (a tie is allowed).
 */
export function choiceAnswer(
  choice: unknown,
  confidence: unknown,
  probabilities: unknown,
  options: readonly string[],
): Result<CallAnswer, InvalidReplyReason> {
  if (
    typeof choice !== 'string' ||
    typeof confidence !== 'number' ||
    !isRecord(probabilities)
  )
    return err('malformed_json');
  if (!options.includes(choice) || !sameKeys(probabilities, options))
    return err('key_mismatch');
  if (!isProbability(confidence)) return err('out_of_range');
  const read = readProbabilities(probabilities, options);
  if (!isOk(read)) return read;
  if (read.value[choice] !== Math.max(...Object.values(read.value)))
    return err('not_most_probable');
  return ok({ choice, confidence, probabilities: read.value });
}

/**
 * A score answer once a provider's wire format is normalised, or the reason
 * it is invalid: `score` must be finite within [0, `levelCount` - 1],
 * `confidence` a probability and `probabilities` must cover exactly the
 * level number strings `"0"` to `"<levelCount - 1>"` with probabilities
 * summing to one. The choice is the most probable level, the lower one on a
 * tie, whatever the fractional score rounds to.
 */
export function levelAnswer(
  score: unknown,
  confidence: unknown,
  probabilities: unknown,
  levelCount: number,
): Result<CallAnswer, InvalidReplyReason> {
  const levelKeys = Array.from({ length: levelCount }, (_, level) =>
    String(level),
  );
  if (
    typeof score !== 'number' ||
    typeof confidence !== 'number' ||
    !isRecord(probabilities)
  )
    return err('malformed_json');
  if (!sameKeys(probabilities, levelKeys)) return err('key_mismatch');
  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > levelCount - 1 ||
    !isProbability(confidence)
  )
    return err('out_of_range');
  const read = readProbabilities(probabilities, levelKeys);
  if (!isOk(read)) return read;
  let top = levelKeys[0] as string;
  for (const key of levelKeys)
    if ((read.value[key] as number) > (read.value[top] as number)) top = key;
  return ok({ choice: top, confidence, score, probabilities: read.value });
}

/**
 * Validates TypeSafe-shaped wire answers, keyed by question id, against the
 * questions asked: missing ids first (`missing_answer`), then extra ids
 * (`key_mismatch`), then each question in order. A noul answer must carry a
 * probability, a choice answer must pass {@link choiceAnswer} and a score
 * answer must echo its question's levels in order in its legend and pass
 * {@link levelAnswer}. Returns the answers as {@link CallAnswer}s with their
 * probabilities.
 */
export function validateWireAnswers(
  answers: unknown,
  evaluation: Evaluation,
): Result<Record<string, CallAnswer>, InvalidReplyReason> {
  if (!isRecord(answers)) return err('malformed_json');
  const ids = Object.keys(evaluation.questions);
  if (ids.some((id) => !Object.hasOwn(answers, id)))
    return err('missing_answer');
  if (Object.keys(answers).length !== ids.length) return err('key_mismatch');
  const validated: Record<string, CallAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(evaluation.questions)) {
    const answer = wireAnswer(answers[id], question);
    if (!isOk(answer)) return answer;
    validated[id] = answer.value;
  }
  return ok(validated);
}

/**
 * The reply a stage reads, usage unchanged. A score answer keeps its
 * probabilities, a noul answer keeps only its probability of yes, and a
 * choice answer keeps its probabilities as a non-enumerable property.
 */
export function withoutProbabilities(reply: Reply): Reply {
  const answers: Record<string, Answer> = Object.create(null);
  for (const [id, answer] of Object.entries(reply.answers))
    answers[id] = replyAnswer(answer);
  return { answers, usage: reply.usage };
}

function wireAnswer(
  answer: unknown,
  question: Question,
): Result<CallAnswer, InvalidReplyReason> {
  if (!isRecord(answer) || typeof answer.type !== 'string')
    return err('malformed_json');
  if (answer.type !== question.type) return err('wrong_type');
  if (question.type === 'noul') {
    if (typeof answer.noul !== 'number') return err('malformed_json');
    if (!isProbability(answer.noul)) return err('out_of_range');
    return ok(noulAnswer(answer.noul));
  }
  if (question.type === 'score') {
    if (!isRecord(answer.legend)) return err('malformed_json');
    const legend = answer.legend;
    const levelKeys = question.criteria.map((_, level) => String(level));
    if (
      !sameKeys(legend, levelKeys) ||
      levelKeys.some((key, level) => legend[key] !== question.criteria[level])
    )
      return err('key_mismatch');
    return levelAnswer(
      answer.score,
      answer.confidence,
      answer.probabilities,
      question.criteria.length,
    );
  }
  return choiceAnswer(
    answer.choice,
    answer.confidence,
    answer.probabilities,
    Object.keys(question.criteria),
  );
}

function readProbabilities(
  probabilities: Record<string, unknown>,
  keys: readonly string[],
): Result<Record<string, number>, InvalidReplyReason> {
  const read: Record<string, number> = Object.create(null);
  let total = 0;
  for (const key of keys) {
    const value = probabilities[key];
    if (typeof value !== 'number') return err('malformed_json');
    if (!isProbability(value)) return err('out_of_range');
    read[key] = value;
    total += value;
  }
  if (!sumsToOne(total)) return err('probability_sum');
  return ok(read);
}

function replyAnswer({
  choice,
  confidence,
  probability,
  score,
  probabilities,
}: Answer): Answer {
  if (score !== undefined && probabilities !== undefined)
    return { choice, confidence, score, probabilities };
  if (probability !== undefined) return { choice, confidence, probability };
  const answer = { choice, confidence };
  if (probabilities !== undefined)
    // Non-enumerable so answer records spread from a choice answer, and every
    // recording and snapshot built from them, keep their earlier shape.
    Object.defineProperty(answer, 'probabilities', {
      value: probabilities,
      enumerable: false,
    });
  return answer;
}

function sumsToOne(total: number): boolean {
  return Math.abs(total - 1) <= 0.02;
}
