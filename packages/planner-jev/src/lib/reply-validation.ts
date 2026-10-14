import type { CallAnswer } from './ask.js';
import type { Answer, Reply } from './questions.js';

const MAX_RESPONSE_BYTES = 256 * 1024;

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
 * A choice answer once a provider's wire format is normalised, or
 * `undefined` unless `choice` is one of `options`, `confidence` is a
 * probability, `probabilities` covers exactly `options` with probabilities
 * summing to one, and `choice` has the highest of them (a tie is allowed).
 */
export function choiceAnswer(
  choice: unknown,
  confidence: unknown,
  probabilities: unknown,
  options: readonly string[],
): CallAnswer | undefined {
  if (
    typeof choice !== 'string' ||
    !isProbability(confidence) ||
    !isRecord(probabilities) ||
    !sameKeys(probabilities, options) ||
    !options.includes(choice)
  )
    return undefined;
  let total = 0;
  let maximum = -1;
  const read: Record<string, number> = Object.create(null);
  for (const option of options) {
    const value = probabilities[option];
    if (!isProbability(value)) return undefined;
    read[option] = value;
    total += value;
    maximum = Math.max(maximum, value);
  }
  if (!sumsToOne(total) || read[choice] !== maximum) return undefined;
  return { choice, confidence, probabilities: read };
}

/**
 * A score answer once a provider's wire format is normalised, or
 * `undefined` unless `score` is finite within [0, `levelCount` - 1],
 * `confidence` is a probability and `probabilities` covers exactly the
 * level number strings `"0"` to `"<levelCount - 1>"` with probabilities
 * summing to one. The choice is the most probable level, the lower one on a
 * tie, whatever the fractional score rounds to.
 */
export function levelAnswer(
  score: unknown,
  confidence: unknown,
  probabilities: unknown,
  levelCount: number,
): CallAnswer | undefined {
  const levelKeys = Array.from({ length: levelCount }, (_, level) =>
    String(level),
  );
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > levelCount - 1 ||
    !isProbability(confidence) ||
    !isRecord(probabilities) ||
    !sameKeys(probabilities, levelKeys)
  )
    return undefined;
  let total = 0;
  let top = levelKeys[0] as string;
  const read: Record<string, number> = Object.create(null);
  for (const key of levelKeys) {
    const value = probabilities[key];
    if (!isProbability(value)) return undefined;
    read[key] = value;
    total += value;
    if (value > (read[top] as number)) top = key;
  }
  if (!sumsToOne(total)) return undefined;
  return { choice: top, confidence, score, probabilities: read };
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

/**
 * The response body as text, or `undefined` once it exceeds 256 KB by its
 * declared length or while streaming.
 *
 * @throws {Error} If the body is missing, `signal` aborts or the stream fails.
 */
export async function readBody(
  response: Response,
  signal: AbortSignal,
): Promise<string | undefined> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES) return undefined;
  if (!response.body) throw new Error('response body missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      if (signal.aborted) throw new Error('request aborted');
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return undefined;
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
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
