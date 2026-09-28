import { createTypeSafeClient, type JevCall } from '../typesafe-client.js';

/** The request body the TypeSafe client sends. */
export interface Payload {
  readonly model: string;
  readonly state: Record<string, unknown>;
  readonly questions: Record<
    string,
    { readonly instructions: string; readonly criteria: Record<string, string> }
  >;
}

/**
 * What one scripted call returns: choices by question id (unlisted
 * questions take their first option), or a failure mode.
 */
export type Step =
  | {
      readonly choices: Readonly<Record<string, string>>;
      readonly confidence?: number;
    }
  | { readonly status: number }
  | { readonly body: string }
  | { readonly reply: unknown }
  | 'oversized'
  | 'hang'
  | 'network';

export type Script = (payload: Payload, call: number) => Step;

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
    if (step === 'hang')
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    if (step === 'network') throw new TypeError('fetch failed');
    if (step === 'oversized')
      return new Response('x'.repeat(256 * 1024 + 1), { status: 200 });
    if ('status' in step)
      return new Response('provider error', { status: step.status });
    if ('body' in step) return new Response(step.body, { status: 200 });
    if ('reply' in step)
      return new Response(JSON.stringify(step.reply), { status: 200 });
    return new Response(
      JSON.stringify(
        buildReply(payload, step.choices, step.confidence ?? 1, model),
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: handler as unknown as typeof fetch, calls };
}

/** A valid TypeSafe reply choosing `choices` (first option where unlisted). */
export function buildReply(
  payload: Payload,
  choices: Readonly<Record<string, string>>,
  confidence = 1,
  model = TEST_MODEL,
) {
  return {
    model,
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => {
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
