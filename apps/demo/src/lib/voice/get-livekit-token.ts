import { createServerFn } from '@tanstack/react-start';
import { mintLiveKitToken } from '@maelstrom-co/realtime-livekit/server';
import { z } from 'zod';

// Guards the trust boundary: a missing/non-string/whitespace-only roomName
// would otherwise reach mintLiveKitToken as-is, either throwing an opaque
// TypeError or minting a token scoped to room "". Trimming here (not just
// validating) also means the minted token always matches the room name a
// caller sees trimmed elsewhere — untrimmed whitespace variants never diverge.
export const inputSchema = z.object({
  roomName: z.string().trim().min(1, 'roomName must be a non-empty string'),
  identity: z.string().optional(),
});

/**
 * TanStack Start server fn wrapping the framework-free `mintLiveKitToken` from
 * `@maelstrom-co/realtime-livekit/server`. This thin wrapper is all the demo
 * owns — the token-grant logic lives in the package. Injected into the
 * `LiveKitAdapter` as `getToken` so the browser bundle never imports
 * `livekit-server-sdk`.
 */
export const getLivekitToken = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => mintLiveKitToken(data));
