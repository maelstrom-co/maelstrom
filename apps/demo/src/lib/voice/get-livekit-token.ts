import { createServerFn } from '@tanstack/react-start';
import { mintLiveKitToken } from '@maelstrom-co/livekit-voice/server';

/**
 * TanStack Start server fn wrapping the framework-free `mintLiveKitToken` from
 * `@maelstrom-co/livekit-voice/server`. This thin wrapper is all the demo owns —
 * the token-grant logic lives in the package. Injected into `liveKitVoice` as
 * `getToken` so the browser bundle never imports `livekit-server-sdk`.
 */
export const getLivekitToken = createServerFn({ method: 'GET' })
  .inputValidator((data: { roomName: string; identity?: string }) => {
    // Guard the trust boundary: an empty/whitespace roomName would otherwise
    // mint a valid token scoped to room "".
    if (data.roomName.trim().length === 0) {
      throw new Error('roomName must be a non-empty string');
    }
    return data;
  })
  .handler(async ({ data }) => mintLiveKitToken(data));
