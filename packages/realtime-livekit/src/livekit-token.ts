import { type TokenGrant, UnixSecondsSchema } from '@maelstrom-co/realtime';
import { z } from 'zod';

/**
 * A LiveKit access token + room URL for a single room, plus the absolute
 * expiry the client uses to refresh proactively before the JWT lapses.
 *
 * The server sibling (`@maelstrom-co/realtime-livekit-server`) mints this;
 * the browser adapter consumes `token`/`url` to join the room and reads
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
  url: z.string().min(1),
  expiresAt: UnixSecondsSchema,
});
