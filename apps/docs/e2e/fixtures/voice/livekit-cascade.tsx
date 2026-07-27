import type { CreateAdapterContext } from '@maelstrom-co/react-realtime';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

declare function fetchLiveKitToken(
  roomName: string,
): Promise<LiveKitTokenGrant>;

/* docs:livekit-adapter-setup:start */
export function createLiveKitAdapter({
  sessionId,
}: CreateAdapterContext): LiveKitAdapter {
  return new LiveKitAdapter({
    roomName: `maelstrom-${sessionId}`,
    mintToken: fetchLiveKitToken,
    thinkingFallbackMs: 10_000,
  });
}
/* docs:livekit-adapter-setup:end */

declare function waitForRelease(): Promise<void>;

/* docs:livekit-turn-control:start */
export async function runHeldTurn(
  turnControl: AdapterTurnControl,
): Promise<void> {
  await turnControl.startTurn();
  try {
    await waitForRelease();
  } finally {
    await turnControl.endTurn();
  }
}
/* docs:livekit-turn-control:end */

interface AuthenticatedVoiceSession {
  /** Authenticated server principal used to key the shared mint rate limit. */
  readonly principalId: string;
  /** Trusted room scope derived from server-side session policy. */
  readonly roomName: string;
  /** Trusted LiveKit participant identity derived by the server. */
  readonly identity: string;
}

/**
 * Application-provided authentication and authorization boundary. It returns
 * only server-derived voice scope, or `null` when either check is denied.
 */
declare function requireAuthenticatedVoiceSession(
  request: Request,
): Promise<AuthenticatedVoiceSession | null>;

/**
 * Application-provided exact-origin check. It fails closed when the origin or
 * its allowlist policy is missing, malformed, or unavailable.
 */
declare function isTrustedVoiceMintOrigin(request: Request): boolean;

/**
 * Application-provided CSRF check for the authenticated session. This is the
 * route's CSRF boundary and returns `false` for absent or invalid proof.
 */
declare function isValidVoiceMintCsrf(
  request: Request,
  session: AuthenticatedVoiceSession,
): boolean;

/**
 * Application-provided shared principal rate limit. Store failures deny the
 * request instead of allowing a mint, and denied results provide a bounded
 * retry delay for the response header.
 */
declare function consumeVoiceMintRateLimit(principalId: string): Promise<
  | {
      /** `true` when this principal may proceed with the current mint. */
      readonly allowed: true;
    }
  | {
      /** `false` for a policy denial or fail-closed policy-store failure. */
      readonly allowed: false;
      /** Bounded delay to expose through the `Retry-After` response header. */
      readonly retryAfterSeconds: number;
    }
>;

/**
 * Application-provided telemetry boundary that must redact raw failure and
 * credential data. Its own rejection is contained by the route.
 */
declare function reportRedactedVoiceMintFailure(input: {
  /** Fixed allowlisted identifier for this route boundary. */
  readonly source: 'livekit-token-route';
  /** Raw caught value supplied only to the application's redaction boundary. */
  readonly error: unknown;
}): Promise<void>;

/** Returns the application's CSRF proof for the current authenticated session. */
declare function getCsrfToken(): string;

/* docs:livekit-token-boundary:start */
import { isOk } from '@maelstrom-co/protocol';
import {
  type LiveKitTokenGrant,
  LiveKitTokenGrantSchema,
} from '@maelstrom-co/realtime-livekit/token';
import {
  mintFailureHttpStatus,
  mintLiveKitToken,
} from '@maelstrom-co/realtime-livekit-server';

const TOKEN_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

/**
 * Authenticates and authorizes one room-token request before minting a grant
 * from server-derived scope. Every response is non-cacheable; unexpected
 * failures cross the boundary only as a generic error after redacted telemetry.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isTrustedVoiceMintOrigin(request)) {
      return Response.json(
        { error: 'request-denied' },
        { status: 403, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    const authenticated = await requireAuthenticatedVoiceSession(request);
    if (authenticated === null) {
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    if (!isValidVoiceMintCsrf(request, authenticated)) {
      return Response.json(
        { error: 'request-denied' },
        { status: 403, headers: TOKEN_RESPONSE_HEADERS },
      );
    }

    const rateLimit = await consumeVoiceMintRateLimit(
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

    const result = await mintLiveKitToken({
      roomName: authenticated.roomName,
      identity: authenticated.identity,
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
      await reportRedactedVoiceMintFailure({
        source: 'livekit-token-route',
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

/**
 * Fetches and validates an authenticated room grant without sending browser-
 * selected room or participant scope. Rejects non-success HTTP responses and
 * schema-invalid response bodies, leaving voice disconnected for the caller.
 */
export async function fetchAuthenticatedLiveKitToken(): Promise<LiveKitTokenGrant> {
  const response = await fetch('/api/livekit-token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': getCsrfToken() },
  });

  if (!response.ok) {
    throw new Error(`LiveKit token mint failed with status ${response.status}`);
  }

  return LiveKitTokenGrantSchema.parse(await response.json());
}
/* docs:livekit-token-boundary:end */

/**
 * Published worker entrypoint, declared here only to compile-check the excerpt.
 * Calling it starts the separate long-running STT/TTS worker process; this
 * fixture declaration does not implement worker behavior.
 */
declare function runVoiceAgent(): void;

/* docs:livekit-worker-reference:start */
runVoiceAgent();
/* docs:livekit-worker-reference:end */
