import { err, ok, type Result } from '@maelstrom-co/protocol';
import type {
  MintFailure,
  MintFetch,
  UnixSeconds,
} from '@maelstrom-co/realtime';
import {
  type OpenAITokenGrant,
  OpenAITokenGrantSchema,
  OpenAITokenRequestSchema,
} from '@maelstrom-co/realtime/openai';
import { z } from 'zod';

/** Options for {@link createOpenAIMinter}. */
export interface CreateOpenAIMinterOptions {
  /** Server-held OpenAI API key. Never forwarded to the caller. */
  readonly apiKey: string;
  /** Realtime model the minted client secret is scoped to. */
  readonly model: string;
  /**
   * Fetch implementation used for the upstream call to OpenAI. Defaults to
   * the global `fetch`; inject a fake in tests to avoid a real network call.
   */
  readonly fetch?: MintFetch;
}

/** Shape of OpenAI's `POST /v1/realtime/client_secrets` response. */
const OpenAIClientSecretResponseSchema = z.object({
  value: z.string(),
  expires_at: z.number(),
  session: z.unknown().optional(),
});

/** Outcome of a {@link createOpenAIMinter} call. */
export type MintResult = Result<OpenAITokenGrant, MintFailure>;

/**
 * Creates a transport-agnostic minter that exchanges a server-held OpenAI
 * API key for a short-lived realtime client secret on behalf of the
 * browser, so the browser never sees `OPENAI_API_KEY`.
 *
 * The minter validates `input` against {@link OpenAITokenRequest}, calls
 * OpenAI's `client_secrets` endpoint with the server-held key in the
 * `Authorization` header, and maps the upstream response to an
 * {@link OpenAITokenGrant}. The API key is only ever sent upstream —
 * it is never echoed back in the result. Callers own all transport
 * concerns: parsing the request body into `input`, and mapping
 * {@link MintResult} to a status code / response body.
 *
 * This mint operation is an **unauthenticated bootstrap**: anyone who can
 * invoke it can mint a short-lived OpenAI realtime credential. A real
 * deployment must add an origin allowlist, a rate limit, and caller
 * authentication in the transport layer in front of it before going live.
 *
 * Only handles `provider: 'openai'` requests — a `google` minter is a
 * sibling. `sessionId` is accepted and validated but currently unused by
 * this minter; it's reserved for the sidechannel receiver to bind the
 * minted session to the Maelstrom session.
 *
 * @example
 * ```ts
 * const mint = createOpenAIMinter({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-realtime-2',
 * });
 *
 * // Wire into a fetch-style route:
 * export async function POST(req: Request): Promise<Response> {
 *   const result = await mint(await req.json());
 *   if (isOk(result)) return Response.json(result.value);
 *
 *   return Response.json(
 *     { error: result.error.reason },
 *     { status: mintFailureHttpStatus(result.error.reason) },
 *   );
 * }
 * ```
 */
export function createOpenAIMinter(
  options: CreateOpenAIMinterOptions,
): (input: unknown) => Promise<MintResult> {
  const { apiKey, model, fetch: injectedFetch } = options;
  const doFetch = injectedFetch ?? fetch;

  return async (input: unknown): Promise<MintResult> => {
    if (!apiKey) {
      return err({ reason: 'missing-api-key' });
    }

    const handshake = OpenAITokenRequestSchema.safeParse(input);
    if (!handshake.success) {
      return err({ reason: 'invalid-request' });
    }

    const resolvedModel = handshake.data.model ?? model;

    let upstream: Response;
    let upstreamBody: z.infer<typeof OpenAIClientSecretResponseSchema>;
    try {
      // `/v1/realtime/client_secrets` nests the model under `session`, not at
      // top level (top-level `model` is rejected as unknown_parameter). Send the
      // documented nested shape so the model we configure is actually honored.
      upstream = await doFetch(
        'https://api.openai.com/v1/realtime/client_secrets',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            expires_after: { anchor: 'created_at', seconds: 600 },
            session: { type: 'realtime', model: resolvedModel },
          }),
        },
      );

      if (!upstream.ok) {
        return err({
          reason: 'upstream-failure',
          upstreamStatus: upstream.status,
        });
      }

      const parsedBody = OpenAIClientSecretResponseSchema.safeParse(
        await upstream.json(),
      );
      if (!parsedBody.success) {
        return err({
          reason: 'upstream-failure',
          upstreamStatus: upstream.status,
        });
      }
      upstreamBody = parsedBody.data;
    } catch {
      return err({ reason: 'upstream-failure' });
    }

    const response: OpenAITokenGrant = {
      provider: 'openai',
      value: upstreamBody.value,
      expiresAt: upstreamBody.expires_at as UnixSeconds,
      model: resolvedModel,
    };

    try {
      OpenAITokenGrantSchema.parse(response);
    } catch {
      return err({ reason: 'upstream-failure' });
    }

    return ok(response);
  };
}
