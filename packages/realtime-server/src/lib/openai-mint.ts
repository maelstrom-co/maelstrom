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
  /** Default realtime model; a validated request model overrides this value. */
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
 * The minter validates `input` against {@link OpenAITokenRequest}. When that
 * request includes a model, the request model overrides the configured default.
 * It then calls
 * OpenAI's `client_secrets` endpoint with the server-held key in the
 * `Authorization` header, and maps the upstream response to an
 * {@link OpenAITokenGrant}. The API key is only ever sent upstream —
 * it is never echoed back in the result. Callers own all transport
 * concerns: parsing the request body into `input`, and mapping
 * {@link MintResult} to a status code / response body.
 *
 * This mint operation is an **unauthenticated bootstrap**: anyone who can
 * invoke it can mint a short-lived OpenAI realtime credential. Production
 * transport code must authenticate and authorize callers, enforce a trusted
 * model policy instead of accepting arbitrary model overrides, and add origin
 * controls, rate limits, and abuse controls before exposing the minter.
 * The example below treats authentication, CSRF, origin, model selection,
 * shared rate limiting, and redacted telemetry as mandatory app-provided
 * fail-closed contracts. Keep the exact server-side origin allowlist check
 * first. When authentication and CSRF validation are not demonstrably cheap
 * and constant-time, run an app-provided fail-closed pre-auth transport
 * throttle before both controls. Key it from a trusted server- or proxy-derived
 * IP-equivalent client address, and reject browser-controlled forwarding
 * headers rather than treating them as trusted address data. Retain the shared
 * principal-keyed limit after authentication and CSRF validation. Both
 * throttles must deny on store failure, return a bounded retry delay, and use
 * the same generic 429 body. Browser input may request a model, but it must
 * never define or widen the trusted server-side model allowlist.
 *
 * Only handles `provider: 'openai'` requests — a `google` minter is a
 * sibling. `sessionId` is accepted and validated but currently unused by
 * this minter; it's reserved for the sidechannel receiver to bind the
 * minted session to the Maelstrom session.
 *
 * @example
 * ```ts
 * import { isOk } from '@maelstrom-co/protocol';
 * import {
 *   createOpenAIMinter,
 *   mintFailureHttpStatus,
 * } from '@maelstrom-co/realtime-server';
 * import { requireAuthenticatedRealtimeSession } from './auth';
 * import {
 *   areRealtimeMintAuthAndCsrfCheapAndConstantTime,
 *   consumeRealtimeMintPreAuthRateLimit,
 *   consumeRealtimeMintRateLimit,
 *   isTrustedRealtimeMintOrigin,
 *   isValidRealtimeMintCsrf,
 *   resolveTrustedRealtimeMintClientAddress,
 *   resolveAllowedRealtimeModel,
 * } from './realtime-mint-policy';
 * import { reportRedactedRealtimeMintFailure } from './redacted-telemetry';
 *
 * const mint = createOpenAIMinter({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-realtime-2',
 * });
 * const headers = { 'Cache-Control': 'private, no-store' };
 *
 * export async function POST(request: Request): Promise<Response> {
 *   try {
 *     if (!isTrustedRealtimeMintOrigin(request)) {
 *       return Response.json({ error: 'request-denied' }, { status: 403, headers });
 *     }
 *
 *     if (!areRealtimeMintAuthAndCsrfCheapAndConstantTime()) {
 *       const clientAddress = resolveTrustedRealtimeMintClientAddress(request);
 *       if (clientAddress === null) {
 *         return Response.json({ error: 'request-denied' }, { status: 403, headers });
 *       }
 *
 *       const preAuthRateLimit =
 *         await consumeRealtimeMintPreAuthRateLimit(clientAddress);
 *       if (!preAuthRateLimit.allowed) {
 *         return Response.json(
 *           { error: 'rate-limited' },
 *           {
 *             status: 429,
 *             headers: {
 *               ...headers,
 *               'Retry-After': String(preAuthRateLimit.retryAfterSeconds),
 *             },
 *           },
 *         );
 *       }
 *     }
 *
 *     const authenticated = await requireAuthenticatedRealtimeSession(request);
 *     if (authenticated === null) {
 *       return Response.json({ error: 'unauthorized' }, { status: 401, headers });
 *     }
 *
 *     if (!isValidRealtimeMintCsrf(request, authenticated)) {
 *       return Response.json({ error: 'request-denied' }, { status: 403, headers });
 *     }
 *
 *     const rateLimit = await consumeRealtimeMintRateLimit(authenticated.principalId);
 *     if (!rateLimit.allowed) {
 *       return Response.json(
 *         { error: 'rate-limited' },
 *         {
 *           status: 429,
 *           headers: { ...headers, 'Retry-After': String(rateLimit.retryAfterSeconds) },
 *         },
 *       );
 *     }
 *
 *     let input: unknown;
 *     try {
 *       input = await request.json();
 *     } catch {
 *       return Response.json({ error: 'invalid-request' }, { status: 400, headers });
 *     }
 *
 *     const model = resolveAllowedRealtimeModel(authenticated, input);
 *     if (model === null) {
 *       return Response.json({ error: 'request-denied' }, { status: 403, headers });
 *     }
 *
 *     const result = await mint({
 *       provider: 'openai',
 *       sessionId: authenticated.sessionId,
 *       model,
 *     });
 *     if (isOk(result)) return Response.json(result.value, { headers });
 *
 *     return Response.json(
 *       { error: 'mint-failed' },
 *       { status: mintFailureHttpStatus(result.error.reason), headers },
 *     );
 *   } catch (error) {
 *     try {
 *       await reportRedactedRealtimeMintFailure({
 *         source: 'openai-token-route',
 *         error,
 *       });
 *     } catch {
 *       // Telemetry failure must not escape the HTTP boundary.
 *     }
 *     return Response.json({ error: 'mint-failed' }, { status: 500, headers });
 *   }
 * }
 * ```
 *
 * OpenAI recommends an `OpenAI-Safety-Identifier` header for client-secret
 * creation. This minter does not yet expose a public upstream-header option, so
 * adding that support remains a follow-up rather than an implied capability of
 * this example.
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
