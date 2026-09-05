/**
 * Per-connection custody for one hosted session.
 *
 * Hibernation resets in-memory state and re-runs the constructor, so the
 * visitor's key cannot simply live in a field and be assumed present. It is
 * held per connection — never per object: a DO can hold several sockets
 * (many tabs, or anyone who obtained the sessionId), and the key one
 * connection presented must not become the key another one spends — dropped
 * on hibernate or close, and re-requested over `playground.rehello`. The key
 * is never written to storage or to `serializeAttachment`, both of which the
 * platform retains; only the non-secret {@link ConnectionMarker} survives.
 *
 * At most one frame PER SOCKET is buffered while a rehello is outstanding,
 * cleared on that socket's hello and on its close. Keyed by WebSocket (not a
 * single object-scoped slot) because two sockets on the same object can each
 * wake from hibernation and need a rehello independently — a single slot
 * would silently drop the second socket's triggering frame. Unbounded
 * buffering would be a memory-growth vector on a socket that never answers
 * the rehello.
 */
import { Context, Layer } from 'effect';

/** Non-secret, survives hibernation. See the module doc for what must NOT. */
export interface ConnectionMarker {
  readonly helloed: true;
  readonly sessionId: string;
}

export interface ConnectionsService {
  /** This connection's key, or null while it has none in hand. */
  readonly keyOf: (ws: WebSocket) => string | null;

  /**
   * Reads the attachment the platform kept across hibernation. Null for a
   * never-helloed connection (or under plain unit tests, where no attachment
   * was ever written).
   */
  readonly markerOf: (ws: WebSocket) => ConnectionMarker | null;

  /** Whether this connection already answered a rehello with "no key". */
  readonly declined: (ws: WebSocket) => boolean;

  /**
   * Records that this connection answered a rehello with `playground.nokey`.
   * Suppresses further rehelos on that socket — it has already said it has
   * nothing to send — so its traffic falls through to the same actionable
   * "No API key set" reply a never-helloed visitor gets, instead of
   * re-arming a handshake the client has explicitly declined.
   */
  readonly markDecline: (ws: WebSocket) => void;

  /**
   * Records a completed hello: stores the key per connection, clears any
   * earlier decline (a key arrived, so it is stale), and writes only the
   * non-secret marker into the hibernation-retained attachment.
   */
  readonly markHello: (
    ws: WebSocket,
    apiKey: string,
    sessionId: string,
  ) => void;

  /**
   * Buffers `raw` as the frame to replay when the outstanding rehello is
   * answered. Returns false — buffering nothing — when a frame is already
   * buffered for this socket; the caller answers such races immediately
   * instead.
   */
  readonly bufferPending: (ws: WebSocket, raw: string) => boolean;

  /** Takes the buffered triggering frame, if any. */
  readonly takePending: (ws: WebSocket) => string | undefined;

  /**
   * Drops everything held for this connection. Shared by close and error
   * handlers: workerd routes some abnormal terminations to the latter, and
   * either one leaving the pending slot's strong WebSocket reference behind
   * would be the same memory-growth problem regardless of which fired.
   */
  readonly forget: (ws: WebSocket) => void;
}

export class Connections extends Context.Service<
  Connections,
  ConnectionsService
>()('@maelstrom/demo/SessionConnections') {}

export const ConnectionsLive: Layer.Layer<Connections> = Layer.sync(
  Connections,
  () => {
    const keys = new WeakMap<WebSocket, string>();
    const pending = new Map<WebSocket, string>();
    const declined = new WeakSet<WebSocket>();

    return Connections.of({
      keyOf: (ws) => keys.get(ws) ?? null,
      markerOf: (ws) => {
        // The attachment was written by markHello with a satisfies-checked
        // literal, but it comes back from the platform as unknown — and on a
        // wake it is attacker-adjacent state we did not write this lifetime.
        // Validate rather than cast, so corrupt or hostile content fails
        // closed to "never helloed" (a rehello) instead of flowing into
        // wasHelloed.
        const parsed: unknown = ws.deserializeAttachment();
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          (parsed as ConnectionMarker).helloed !== true ||
          typeof (parsed as ConnectionMarker).sessionId !== 'string'
        ) {
          return null;
        }
        return parsed as ConnectionMarker;
      },
      declined: (ws) => declined.has(ws),
      markDecline: (ws) => {
        declined.add(ws);
      },
      markHello: (ws, apiKey, sessionId) => {
        keys.set(ws, apiKey);
        declined.delete(ws);
        ws.serializeAttachment({
          helloed: true,
          sessionId,
        } satisfies ConnectionMarker);
      },
      bufferPending: (ws, raw) => {
        if (pending.has(ws)) return false;
        pending.set(ws, raw);
        return true;
      },
      takePending: (ws) => {
        const raw = pending.get(ws);
        pending.delete(ws);
        return raw;
      },
      forget: (ws) => {
        keys.delete(ws);
        pending.delete(ws);
      },
    });
  },
);
