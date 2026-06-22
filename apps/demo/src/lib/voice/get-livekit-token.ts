import { createServerFn } from '@tanstack/react-start';
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
 * Mints a LiveKit access token scoped to a single room + identity. Extracted
 * from the server-fn handler so the token-grant wiring is unit-testable without
 * a live TanStack Start request context.
 */
export async function mintLiveKitToken(
  data: LiveKitTokenInput,
): Promise<LiveKitTokenResult> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';

  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit credentials not configured');
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: data.identity ?? 'user',
  });
  at.addGrant({
    roomJoin: true,
    room: data.roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return { token: await at.toJwt(), url };
}

export const getLivekitToken = createServerFn({ method: 'GET' })
  .inputValidator((data: LiveKitTokenInput) => data)
  .handler(async ({ data }) => mintLiveKitToken(data));
