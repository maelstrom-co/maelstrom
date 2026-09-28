import type {
  CancellationError,
  Deferred,
  StageContext,
} from '@maelstrom-co/engine';
import { isErr, ok, type Result } from '@maelstrom-co/protocol';

import { deferAt, type StageName } from '../defer.js';
import type { Answer, Evaluation, Question, Reply } from '../questions.js';
import type { Ask } from '../typesafe-client.js';

/**
 * The serialized request size one TypeSafe call is packed up to, in bytes.
 * Past some size TypeSafe rejects the body with `max_tokens_exceeded`,
 * which the client reports as `provider_http`. A live run put every
 * accepted request at or below 126 KB and every rejected one at 151 KB or
 * above, so this budget stays inside the range that was accepted rather
 * than just under the one that was not.
 */
export const MAX_REQUEST_BYTES = 96 * 1024;

/**
 * How many of one stage's chunked calls are in flight at once. TypeSafe has
 * never rate-limited this package and no other stage fans out, so the cap
 * stays low enough that a wide turn cannot open an unbounded number of
 * requests.
 */
export const MAX_CONCURRENT_CALLS = 4;

/** Overrides for {@link askInChunks}, for tests and for tuning one stage. */
export interface FanOutOptions {
  readonly maxRequestBytes?: number;
  readonly maxConcurrentCalls?: number;
}

/**
 * Asks `evaluation` in as few TypeSafe calls as {@link MAX_REQUEST_BYTES}
 * allows, at most {@link MAX_CONCURRENT_CALLS} of them in flight, and merges
 * the answers and token usage into one reply. Every call repeats the state,
 * and questions are answered independently of one another, so the answers
 * match what one call over the whole set would give. Defers
 * `<stage>/batch_cap` when the state and one question alone are over the
 * budget, and returns the failure of the earliest failing chunk when a call
 * fails.
 */
export async function askInChunks(
  ask: Ask,
  stage: StageName,
  evaluation: Evaluation,
  ctx: StageContext,
  options: FanOutOptions = {},
): Promise<Result<Reply, Deferred | CancellationError>> {
  const packed = packChunks(
    evaluation,
    options.maxRequestBytes ?? MAX_REQUEST_BYTES,
  );
  if (typeof packed === 'string')
    return deferAt(ctx, stage, 'batch_cap', packed);
  const replies = await inFlight(
    packed,
    options.maxConcurrentCalls ?? MAX_CONCURRENT_CALLS,
    (questions) => ask(stage, { state: evaluation.state, questions }, ctx),
  );
  const answers: Record<string, Answer> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  for (const reply of replies) {
    if (isErr(reply)) return reply;
    Object.assign(answers, reply.value.answers);
    inputTokens += reply.value.usage.inputTokens;
    outputTokens += reply.value.usage.outputTokens;
  }
  return ok({ answers, usage: { inputTokens, outputTokens } });
}

const encoder = new TextEncoder();

/** The envelope of the request body: the model field, the keys and the punctuation. */
const ENVELOPE_BYTES = 128;

/**
 * Greedy packing in question order, or the id of the first question that
 * cannot share a request with the state. An empty question set packs into
 * one empty chunk, so a stage with nothing to ask still calls once.
 */
function packChunks(
  evaluation: Evaluation,
  maxRequestBytes: number,
): Record<string, Question>[] | string {
  const fixed = ENVELOPE_BYTES + byteLength(evaluation.state);
  const chunks: Record<string, Question>[] = [];
  let current: Record<string, Question> | undefined;
  let used = 0;
  for (const [id, question] of Object.entries(evaluation.questions)) {
    const bytes = byteLength(id) + byteLength(question) + 1;
    if (fixed + bytes > maxRequestBytes) return id;
    if (current === undefined || used + bytes > maxRequestBytes) {
      current = { [id]: question };
      chunks.push(current);
      used = fixed + bytes;
      continue;
    }
    current[id] = question;
    used += bytes;
  }
  return chunks.length > 0 ? chunks : [{}];
}

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

async function inFlight<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index];
      if (item !== undefined) results[index] = await run(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}
