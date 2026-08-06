import {
  type TokenGrant,
  type UnixSeconds,
  UnixSecondsSchema,
} from '@maelstrom-co/realtime';
import { z } from 'zod';

/**
 * A LiveKit access token and room URL for a single room.
 *
 * The server sibling (`@maelstrom-co/realtime-livekit-server`) mints this;
 * the browser adapter consumes `token` and `url` to join the room. The grant's
 * `expiresAt` describes validity for each initial or fresh room connection,
 * including an explicit `connect()` after `disconnect()`. Expiration does not
 * affect an active room or SDK-managed reconnects for an already connected
 * participant because LiveKit pushes refreshed tokens to connected clients.
 * The browser adapter does not read `expiresAt` or schedule proactive renewal.
 */
export interface LiveKitTokenGrant extends TokenGrant {
  readonly token: string;
  readonly url: string;
  /**
   * Absolute Unix-epoch second after which this JWT cannot authenticate an
   * initial or fresh room connection. Token expiry is checked for each such
   * connection, including an explicit `connect()` after `disconnect()`. It does
   * not impact SDK-managed reconnects for an already connected participant:
   * LiveKit pushes refreshed tokens to connected clients, and the SDK uses the
   * refreshed token for managed reconnects. Expiry alone does not disconnect an
   * active participant or end the room.
   *
   * {@link LiveKitAdapter} does not read this value or schedule an automatic
   * refresh or impose a maximum active-room duration. Each fresh `connect()`
   * invokes `mintToken`. Production hosts must enforce session-duration and
   * cleanup policy independently of this timestamp.
   */
  readonly expiresAt: UnixSeconds;
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
