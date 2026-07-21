// Node-only entry: LiveKit token minting. Reachable only via the `./server`
// subpath so the browser bundle never pulls in `livekit-server-sdk`. The
// transport-specific server-fn wrapper (e.g. TanStack Start's `createServerFn`)
// stays in the consuming app; this package ships only the framework-free grant.

import { AccessToken } from 'livekit-server-sdk';

export interface LiveKitTokenInput {
  roomName: string;
  identity?: string;
}

export interface LiveKitTokenResult {
  token: string;
  url: string;
}

/**
 * Mints a LiveKit access token scoped to a single room + identity, reading
 * credentials from `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` and the room URL
 * from `LIVEKIT_URL` (defaulting to a local dev server). The token lifetime is
 * read from `LIVEKIT_TOKEN_TTL` (defaulting to `15m`). Throws when the
 * credentials are absent so a misconfigured deploy fails loudly instead of
 * minting an unusable token.
 *
 * @example
 * ```ts
 * // In a TanStack Start server fn:
 * import { createServerFn } from '@tanstack/react-start';
 * import { mintLiveKitToken } from '@maelstrom-co/realtime-livekit/server';
 *
 * export const getLivekitToken = createServerFn({ method: 'GET' })
 *   .inputValidator((d: { roomName: string }) => d)
 *   .handler(({ data }) => mintLiveKitToken(data));
 * ```
 */
export async function mintLiveKitToken(
  data: LiveKitTokenInput,
): Promise<LiveKitTokenResult> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
  const ttl = process.env.LIVEKIT_TOKEN_TTL ?? '15m';

  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit credentials not configured');
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: data.identity ?? 'user',
    ttl,
  });
  at.addGrant({
    roomJoin: true,
    room: data.roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return { token: await at.toJwt(), url };
}
