import {
  TokenHandshakeRequestSchema,
  TokenHandshakeResponseSchema,
  type TokenHandshakeResponse,
} from '@maelstrom-co/protocol';

/** Options for {@link createOpenAIMintHandler}. */
export interface CreateOpenAIMintHandlerOptions {
  /** Server-held OpenAI API key. Never forwarded to the caller. */
  readonly apiKey: string;
  /** Realtime model the minted client secret is scoped to. */
  readonly model: string;
  /**
   * Fetch implementation used for the upstream call to OpenAI. Defaults to
   * the global `fetch`; inject a fake in tests to avoid a real network call.
   */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Shape of OpenAI's `POST /v1/realtime/client_secrets` response. */
interface OpenAIClientSecretResponse {
  readonly value: string;
  readonly expires_at: number;
  readonly session?: unknown;
}

/**
 * Creates a framework-agnostic handler that mints an OpenAI realtime
 * ephemeral client secret on behalf of the browser, so the browser never
 * sees `OPENAI_API_KEY`.
 *
 * The handler validates the incoming {@link TokenHandshakeRequest}, calls
 * OpenAI's `client_secrets` endpoint with the server-held key in the
 * `Authorization` header, and maps the upstream response to a
 * {@link TokenHandshakeResponse}. The API key is only ever sent upstream —
 * it is never echoed back in the response body.
 *
 * This mint endpoint is an **unauthenticated bootstrap**: anyone who can
 * reach it can mint a short-lived OpenAI realtime credential. A real
 * deployment must add an origin allowlist, a rate limit, and caller
 * authentication in front of it before going live.
 *
 * Only handles `provider: 'openai'` requests — a `google` handler is a
 * sibling. `sessionId` is accepted and validated but currently unused by
 * this handler; it's reserved for the sidechannel receiver to bind the
 * minted session to the Maelstrom session.
 *
 * @example
 * ```ts
 * const handler = createOpenAIMintHandler({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-realtime-2',
 * });
 * export const POST = handler; // wire into your framework's fetch adapter
 * ```
 */
export function createOpenAIMintHandler(
  options: CreateOpenAIMintHandlerOptions,
): (req: Request) => Promise<Response> {
  const { apiKey, model, fetch: injectedFetch } = options;
  const doFetch = injectedFetch ?? fetch;

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 400 });
    }

    if (!apiKey) {
      return Response.json({ error: 'Missing OpenAI API key' }, { status: 500 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return Response.json({ error: 'Malformed request body' }, { status: 400 });
    }

    const handshake = TokenHandshakeRequestSchema.safeParse(parsedBody);
    if (!handshake.success) {
      return Response.json({ error: 'Invalid token handshake request' }, { status: 400 });
    }

    if (handshake.data.provider !== 'openai') {
      return Response.json(
        { error: `Unsupported provider for this endpoint: ${handshake.data.provider}` },
        { status: 400 },
      );
    }

    const resolvedModel = handshake.data.model ?? model;

    let upstream: Response;
    let upstreamBody: OpenAIClientSecretResponse;
    try {
      // `/v1/realtime/client_secrets` nests the model under `session`, not at
      // top level (top-level `model` is rejected as unknown_parameter). Send the
      // documented nested shape so the model we configure is actually honored.
      upstream = await doFetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: { type: 'realtime', model: resolvedModel },
        }),
      });

      if (!upstream.ok) {
        return Response.json(
          { error: 'Token mint failed upstream', upstreamStatus: upstream.status },
          { status: 502 },
        );
      }

      upstreamBody = (await upstream.json()) as OpenAIClientSecretResponse;
    } catch {
      return Response.json({ error: 'Token mint request failed' }, { status: 502 });
    }

    const response: TokenHandshakeResponse = {
      provider: 'openai',
      value: upstreamBody.value,
      expiresAt: upstreamBody.expires_at,
      model: resolvedModel,
    };

    try {
      TokenHandshakeResponseSchema.parse(response);
    } catch {
      return Response.json({ error: 'Token mint request failed' }, { status: 502 });
    }

    return Response.json(response);
  };
}
