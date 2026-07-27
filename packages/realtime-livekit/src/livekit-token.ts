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
 * the browser adapter consumes `token` and `url` to join the room.
 */
export interface LiveKitTokenGrant extends TokenGrant {
  readonly token: string;
  readonly url: string;
  /**
   * Absolute Unix-epoch second after which this JWT cannot authenticate a new
   * room connection. Expiry does not end an established room or LiveKit's
   * subsequent reconnects.
   *
   * {@link LiveKitAdapter} does not read this value or schedule an automatic
   * refresh. To obtain a fresh credential, callers must disconnect and call
   * `connect()` again; that call invokes `mintToken` before rejoining the room.
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
