import { type TokenGrant, UnixSecondsSchema } from '@maelstrom-co/realtime';
import { z } from 'zod';

/**
 * A LiveKit access token + room URL for a single room, plus the absolute
 * expiry a client can use to refresh proactively before the JWT lapses.
 *
 * The server sibling (`@maelstrom-co/realtime-livekit-server`) mints this;
 * the browser adapter consumes `token`/`url` to join the room and can use
 * `expiresAt` to schedule a refresh — the LiveKit token TTL is a server-side
 * env setting the browser cannot otherwise see.
 */
export interface LiveKitTokenGrant extends TokenGrant {
  readonly token: string;
  readonly url: string;
}

/** Wire schema for {@link LiveKitTokenGrant}. */
export const LiveKitTokenGrantSchema = z.object({
  token: z.string().min(1),
  // room.connect() speaks the LiveKit WebSocket signal protocol, so only
  // ws/wss URLs are usable — reject http(s) at the boundary rather than let a
  // mistyped scheme surface as an opaque connect failure.
  url: z.url({ protocol: /^wss?$/ }),
  expiresAt: UnixSecondsSchema,
});
