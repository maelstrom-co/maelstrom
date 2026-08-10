import { createMaelstrom } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

declare function fetchLiveKitToken(
  roomName: string,
): Promise<LiveKitTokenGrant>;

// Supplied by the reader's own app: the Vessel list and the guide's grant
// fetch, which the browser-grant region above defines in full.
declare const vessels: [];
declare const roomName: string;
declare const mintToken: (roomName: string) => Promise<LiveKitTokenGrant>;

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

/**
 * The guide's own `src/maelstrom.ts` excerpt — the variant a production reader
 * copies. It differs from the tutorial's adapter above (no `thinkingFallbackMs`,
 * a grant fetch that takes no room name), so it needs its own region: covering
 * only the tutorial variant left the guide's import path uncompiled, which is
 * how it came to name a file the guide never creates.
 */
/* docs:livekit-guide-adapter:start */
export const m = createMaelstrom({ vessels }).with(
  maelstromRealtime({
    createAdapter: ({ sessionId }: CreateAdapterContext) =>
      new LiveKitAdapter({
        roomName: `maelstrom-${sessionId}`,
        mintToken: (_roomName) => fetchAuthenticatedLiveKitToken(),
      }),
  }),
);
/* docs:livekit-guide-adapter:end */

/**
 * Tuning and opting out. Compiled here because the `vad` object is an allowlist:
 * a key the adapter does not accept is a type error, and a guide that showed one
 * would send readers to a runtime rejection.
 */
/* docs:livekit-vad-tuning:start */
new LiveKitAdapter({
  roomName,
  mintToken,
  vad: {
    // Where the build step copied the assets. `/vad-web/` is the default.
    assetBaseUrl: '/vad-web/',
    preRollMs: 300,
    providerOptions: {
      positiveSpeechThreshold: 0.8,
      minSpeechMs: 100,
    },
  },
});
/* docs:livekit-vad-tuning:end */

/* docs:livekit-vad-off:start */
new LiveKitAdapter({ roomName, mintToken, vad: false });
/* docs:livekit-vad-off:end */

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
} from '@maelstrom-co/realtime-protocol/livekit';

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
