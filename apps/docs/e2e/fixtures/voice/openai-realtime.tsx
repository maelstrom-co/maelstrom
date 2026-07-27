import { isOk } from '@maelstrom-co/protocol';
import {
  OpenAIAdapter,
  type OpenAITokenGrant,
  OpenAITokenGrantSchema,
} from '@maelstrom-co/realtime/openai';
import {
  createOpenAIMinter,
  mintFailureHttpStatus,
} from '@maelstrom-co/realtime-server';

interface AuthenticatedRealtimeSession {
  readonly principalId: string;
  readonly sessionId: string;
}

interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

declare function areRealtimeMintAuthAndCsrfCheapAndConstantTime(): boolean;
declare function consumeRealtimeMintPreAuthRateLimit(
  clientAddress: string,
): Promise<RateLimitDecision>;
declare function consumeRealtimeMintRateLimit(
  principalId: string,
): Promise<RateLimitDecision>;
declare function getCsrfToken(): string;
declare function isTrustedRealtimeMintOrigin(request: Request): boolean;
declare function isValidRealtimeMintCsrf(
  request: Request,
  session: AuthenticatedRealtimeSession,
): boolean;
declare function reportRedactedRealtimeMintFailure(input: {
  readonly source: 'openai-token-route';
  readonly error: unknown;
}): Promise<void>;
declare function requireAuthenticatedRealtimeSession(
  request: Request,
): Promise<AuthenticatedRealtimeSession | null>;
declare function resolveAllowedRealtimeModel(
  session: AuthenticatedRealtimeSession,
  input: unknown,
): string | null;
declare function resolveTrustedRealtimeMintClientAddress(
  request: Request,
): string | null;

/* docs:openai-server-minter:start */
const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: 'gpt-realtime-2',
});
const TOKEN_RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isTrustedRealtimeMintOrigin(request)) {
      return Response.json(
        { error: 'request-denied' },
        { status: 403, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    if (!areRealtimeMintAuthAndCsrfCheapAndConstantTime()) {
      const clientAddress = resolveTrustedRealtimeMintClientAddress(request);
      if (clientAddress === null) {
        return Response.json(
          { error: 'request-denied' },
          { status: 403, headers: TOKEN_RESPONSE_HEADERS },
        );
      }

      const preAuthRateLimit =
        await consumeRealtimeMintPreAuthRateLimit(clientAddress);
      if (!preAuthRateLimit.allowed) {
        return Response.json(
          { error: 'rate-limited' },
          {
            status: 429,
            headers: {
              ...TOKEN_RESPONSE_HEADERS,
              'Retry-After': String(preAuthRateLimit.retryAfterSeconds),
            },
          },
        );
      }
    }

    const authenticated = await requireAuthenticatedRealtimeSession(request);
    if (authenticated === null) {
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    if (!isValidRealtimeMintCsrf(request, authenticated)) {
      return Response.json(
        { error: 'request-denied' },
        { status: 403, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    const rateLimit = await consumeRealtimeMintRateLimit(
      authenticated.principalId,
    );
    if (!rateLimit.allowed) {
      return Response.json(
        { error: 'rate-limited' },
        {
          status: 429,
          headers: {
            ...TOKEN_RESPONSE_HEADERS,
            'Retry-After': String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return Response.json(
        { error: 'invalid-request' },
        { status: 400, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    const model = resolveAllowedRealtimeModel(authenticated, input);
    if (model === null) {
      return Response.json(
        { error: 'request-denied' },
        { status: 403, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    const result = await mint({
      provider: 'openai',
      sessionId: authenticated.sessionId,
      model,
    });
    if (isOk(result)) {
      return Response.json(result.value, { headers: TOKEN_RESPONSE_HEADERS });
    }

    return Response.json(
      { error: 'mint-failed' },
      {
        status: mintFailureHttpStatus(result.error.reason),
        headers: TOKEN_RESPONSE_HEADERS,
      },
    );
  } catch (error) {
    try {
      await reportRedactedRealtimeMintFailure({
        source: 'openai-token-route',
        error,
      });
    } catch {
      // Telemetry failure must not escape the HTTP boundary.
    }
    return Response.json(
      { error: 'mint-failed' },
      { status: 500, headers: TOKEN_RESPONSE_HEADERS },
    );
  }
}
/* docs:openai-server-minter:end */

/* docs:openai-browser-grant:start */
export async function mintOpenAIToken(): Promise<OpenAITokenGrant> {
  const response = await fetch('/api/realtime-token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Token mint failed with status ${response.status}`);
  }

  return OpenAITokenGrantSchema.parse(await response.json());
}
/* docs:openai-browser-grant:end */

/* docs:openai-adapter-setup:start */
export function createOpenAIAdapter(): OpenAIAdapter {
  return new OpenAIAdapter({
    mintToken: mintOpenAIToken,
  });
}
/* docs:openai-adapter-setup:end */
