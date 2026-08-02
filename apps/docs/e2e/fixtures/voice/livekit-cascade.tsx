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

/** Returns the application's CSRF proof for the current authenticated session. */
declare function getCsrfToken(): string;

/* docs:livekit-minimal-minter:start */
import { isOk } from '@maelstrom-co/protocol';
import {
  mintFailureHttpStatus,
  mintLiveKitToken,
} from '@maelstrom-co/realtime-livekit-server';

export async function POST(request: Request): Promise<Response> {
  const authenticated = await requireAuthenticatedVoiceSession(request);
  if (authenticated === null) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await mintLiveKitToken({
    roomName: authenticated.roomName,
    identity: authenticated.identity,
  });
  if (!isOk(result)) {
    return Response.json(
      { error: 'mint-failed' },
      { status: mintFailureHttpStatus(result.error.reason) },
    );
  }

  return Response.json(result.value, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

/* docs:livekit-minimal-minter:end */

/**
 * Fetches and validates an authenticated room grant without sending browser-
 * selected room or participant scope. Rejects non-success HTTP responses and
 * schema-invalid response bodies, leaving voice disconnected for the caller.
 */
/* docs:livekit-browser-grant:start */
import {
  type LiveKitTokenGrant,
  LiveKitTokenGrantSchema,
} from '@maelstrom-co/realtime-livekit/token';

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
/* docs:livekit-browser-grant:end */

/**
 * Published worker entrypoint, declared here only to compile-check the excerpt.
 * Calling it starts the separate long-running STT/TTS worker process; this
 * fixture declaration does not implement worker behavior.
 */
declare function runVoiceAgent(): void;

/* docs:livekit-worker-reference:start */
runVoiceAgent();
/* docs:livekit-worker-reference:end */
