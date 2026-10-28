import { z } from 'zod';

const endpoint = 'https://api.openai.com/v1/responses';

/** Transport seam for offline verification; production uses native fetch. */
export type ManualFetch = (
  input: string | Request | URL,
  init?: RequestInit,
) => Promise<Response>;

/** At most one generation transmission per turn; any failure permanently closes this run. */
export function manualTransport(
  send: ManualFetch,
  apiKey: string,
  model: string,
  maxOutputTokens: number,
  maxTurns: 1 | 3,
) {
  const wire = z.strictObject({
    model: z.literal(model),
    prompt_cache_key: z.string().min(1).max(64).regex(/\S/).optional(),
    instructions: z.string(),
    input: z.array(
      z.strictObject({
        type: z.literal('message').optional(),
        role: z.enum(['user', 'assistant']),
        content: z.union([
          z.string(),
          z.array(
            z.strictObject({
              type: z.enum(['input_text', 'output_text']),
              text: z.string(),
            }),
          ),
        ]),
      }),
    ),
    text: z.strictObject({
      format: z.strictObject({
        type: z.literal('json_schema'),
        name: z.string().optional(),
        schema: z.record(z.string(), z.unknown()),
        strict: z.literal(true),
      }),
    }),
    stream: z.literal(true),
    max_output_tokens: z.literal(maxOutputTokens),
    service_tier: z.literal('default'),
    store: z.literal(false),
    include: z.array(z.never()).length(0),
  });
  let turn = -1;
  let sent = false;
  let finished = true;
  let stopped = false;
  let transmissions = 0;
  const stop = (): never => {
    stopped = true;
    // SDK errors can echo credentials, so neither causes nor response bodies escape.
    throw new Error('Manual eval transport stopped; no retry is permitted');
  };
  return {
    beginTurn(index: number) {
      if (stopped || index !== turn + 1 || index >= maxTurns || !finished)
        stop();
      turn = index;
      sent = false;
      finished = false;
    },
    assertDispatched() {
      if (stopped || !sent) stop();
      finished = true;
    },
    count: () => transmissions,
    fetch: async (input: string | Request | URL, init?: RequestInit) => {
      try {
        if (stopped || turn < 0 || sent || transmissions >= maxTurns) stop();
        // Reserve before awaiting: concurrent calls cannot both pass the gate.
        sent = true;
        const request =
          input instanceof Request
            ? new Request(input, init)
            : new Request(String(input), init);
        if (
          request.url !== endpoint ||
          request.method !== 'POST' ||
          request.headers.get('authorization') !== `Bearer ${apiKey}`
        )
          stop();
        wire.parse(await request.clone().json());
        if (stopped || request.signal.aborted) stop();
        transmissions++;
        const response = await send(
          new Request(request, { redirect: 'error' }),
        );
        if (stopped || !response.ok) stop();
        return response;
      } catch {
        return stop();
      }
    },
  };
}
