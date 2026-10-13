import { createTypeSafeClient, type JevCall } from '../typesafe-client.js';

/** The request body the TypeSafe client sends. */
export interface Payload {
  readonly model: string;
  readonly state: Record<string, unknown>;
  readonly questions: Record<
    string,
    {
      readonly type: 'choice' | 'noul' | 'score';
      readonly instructions: string;
      /**
       * Absent on a noul question. On a score question it is the JSON array
       * of ordered levels, whose keys read as `"0"`, `"1"` and so on.
       */
      readonly criteria: Record<string, string>;
    }
  >;
}

/**
 * What one scripted call returns: choices by question id (unlisted
 * questions take their first option), noul probabilities by question id
 * (unlisted nouls answer 0) and score levels by question id (unlisted
 * scores answer level 0), or a failure mode:
 * - `{ status, body? }`: a non-2xx response whose body is `body`, streamed
 *   in 1 KB chunks without a declared length, or `provider error` as text
 * - `{ body }`: a 200 response with exactly `body`
 * - `{ reply }`: a 200 response with `reply` as JSON
 * - `oversized`: a 200 body over 256 KB with its length declared
 * - `oversized-stream`: a 200 body over 256 KB streamed without a declared length
 * - `stall`: a 200 body that sends its first chunk and then never another
 * - `reset`: a 200 body that sends its first chunk and then fails
 * - `stalled-error`: a 500 response whose body sends its first chunk and
 *   then never another
 * - `hang`: a request that never responds until its signal aborts
 * - `network`: a request that fails to connect
 */
export type Step =
  | {
      readonly choices: Readonly<Record<string, string>>;
      readonly confidence?: number;
      readonly nouls?: Readonly<Record<string, number>>;
      readonly scores?: Readonly<Record<string, number>>;
    }
  | { readonly status: number; readonly body?: string }
  | { readonly body: string }
  | { readonly reply: unknown }
  | 'oversized'
  | 'oversized-stream'
  | 'stall'
  | 'reset'
  | 'stalled-error'
  | 'hang'
  | 'network';

export type Script = (payload: Payload, call: number) => Step;

type AnsweringStep = Extract<Step, { readonly choices: unknown }>;

const OVERSIZED_BYTES = 256 * 1024 + 1;

export const TEST_MODEL = 'jev-test';

/** A fetch that answers TypeSafe calls from `script` and records every payload. */
export function scriptedFetch(
  script: Script,
  model = TEST_MODEL,
): { readonly fetch: typeof fetch; readonly calls: Payload[] } {
  const calls: Payload[] = [];
  const handler = async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    calls.push(payload);
    const step = script(payload, calls.length - 1);
    const failing = failureResponse(step, init?.signal);
    if (failing) return failing;
    const answering = step as AnsweringStep;
    return new Response(
      JSON.stringify(
        buildReply(
          payload,
          answering.choices,
          answering.confidence ?? 1,
          model,
          answering.nouls,
          answering.scores,
        ),
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: handler as unknown as typeof fetch, calls };
}

/**
 * The response to a scripted step that does not answer, or `undefined` for
 * a step that answers. Shared by every scripted fetch fake, so each failure
 * mode behaves the same on every provider.
 */
export function failureResponse(
  step: Step | { readonly refuse: readonly string[] },
  signal?: AbortSignal | null,
): Promise<Response> | undefined {
  if (step === 'hang')
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    });
  if (step === 'network') return Promise.reject(new TypeError('fetch failed'));
  if (step === 'oversized')
    return Promise.resolve(
      new Response('x'.repeat(OVERSIZED_BYTES), {
        status: 200,
        headers: { 'content-length': String(OVERSIZED_BYTES) },
      }),
    );
  if (step === 'oversized-stream')
    return Promise.resolve(
      new Response(chunkedBody('x'.repeat(OVERSIZED_BYTES), 16 * 1024), {
        status: 200,
      }),
    );
  if (step === 'stall')
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"model":'));
          },
        }),
        { status: 200 },
      ),
    );
  if (step === 'reset')
    return Promise.resolve(
      new Response(failingBody('{"model":'), { status: 200 }),
    );
  if (step === 'stalled-error')
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"error":'));
          },
        }),
        { status: 500 },
      ),
    );
  if ('status' in step)
    return Promise.resolve(
      step.body === undefined
        ? new Response('provider error', { status: step.status })
        : new Response(chunkedBody(step.body, 1024), { status: step.status }),
    );
  if ('body' in step)
    return Promise.resolve(new Response(step.body, { status: 200 }));
  if ('reply' in step)
    return Promise.resolve(
      new Response(JSON.stringify(step.reply), { status: 200 }),
    );
  return undefined;
}

/**
 * A valid TypeSafe reply choosing `choices` (first option where unlisted),
 * answering each noul from `nouls` (0 where unlisted) and putting all of
 * each score's probability on its level from `scores` (0 where unlisted).
 */
export function buildReply(
  payload: Payload,
  choices: Readonly<Record<string, string>>,
  confidence = 1,
  model = TEST_MODEL,
  nouls: Readonly<Record<string, number>> = {},
  scores: Readonly<Record<string, number>> = {},
) {
  return {
    model,
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => {
        if (question.type === 'noul')
          return [id, { type: 'noul', noul: nouls[id] ?? 0 }];
        if (question.type === 'score') {
          const levels = Object.values(question.criteria);
          const level = scores[id] ?? 0;
          if (!Number.isInteger(level) || level < 0 || level >= levels.length)
            throw new Error(`scripted level ${level} is not a level of ${id}`);
          return [
            id,
            {
              type: 'score',
              score: level,
              confidence,
              legend: Object.fromEntries(
                levels.map((text, index) => [String(index), text]),
              ),
              probabilities: Object.fromEntries(
                levels.map((_, index) => [
                  String(index),
                  index === level ? 1 : 0,
                ]),
              ),
            },
          ];
        }
        const options = Object.keys(question.criteria);
        const chosen = choices[id] ?? options[0];
        if (!options.includes(chosen))
          throw new Error(
            `scripted choice ${chosen} is not an option of ${id}`,
          );
        return [
          id,
          {
            type: 'choice',
            choice: chosen,
            confidence,
            probabilities: Object.fromEntries(
              options.map((option) => [option, option === chosen ? 1 : 0]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 11, output_tokens: 2 },
  };
}

/** The option of question `id` whose description contains `text`. */
export function optionContaining(
  payload: Payload,
  id: string,
  text: string,
): string {
  const question = payload.questions[id];
  if (!question) throw new Error(`no question ${id}`);
  const found = Object.entries(question.criteria).find(([, description]) =>
    description.includes(text),
  );
  if (!found) throw new Error(`no option of ${id} mentions ${text}`);
  return found[0];
}

/** A TypeSafe client answering from `script`, with every payload and call recorded. */
export function scriptedAsk(
  script: Script,
  options: { timeoutMs?: number } = {},
) {
  const { fetch, calls } = scriptedFetch(script);
  const reported: JevCall[] = [];
  const ask = createTypeSafeClient({
    apiKey: 'typesafe-test-key',
    model: TEST_MODEL,
    fetch,
    timeoutMs: options.timeoutMs ?? 1000,
    onCall: (call) => reported.push(call),
  });
  return { ask, calls, reported };
}

function chunkedBody(
  text: string,
  chunkBytes: number,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkBytes));
        offset += chunkBytes;
      },
    },
    { highWaterMark: 0 },
  );
}

function failingBody(firstChunk: string): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent) {
          controller.error(new TypeError('connection reset'));
          return;
        }
        controller.enqueue(new TextEncoder().encode(firstChunk));
        sent = true;
      },
    },
    { highWaterMark: 0 },
  );
}
