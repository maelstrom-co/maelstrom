/**
 * Wire shape of the WebSocket heartbeat mechanism — the client connector's
 * `heartbeatIntervalMs` option. These frames are
 * transport-level only: they are deliberately **not** part of the
 * `@maelstrom-co/protocol` envelope union, so a host answering the heartbeat
 * (e.g. a hosted deployment's server) must match this shape exactly rather
 * than reimplementing it from memory or trying to route it through the
 * protocol codec.
 *
 * @example
 * ```ts
 * // Server-side: reply to every ping with a pong, verbatim.
 * ws.addEventListener('message', (event) => {
 *   if (event.data === HEARTBEAT_PING_FRAME) {
 *     ws.send(HEARTBEAT_PONG_FRAME);
 *   }
 * });
 * ```
 */
export const HEARTBEAT_PING_FRAME = '{"type":"heartbeat.ping"}';

/** Wire shape of the heartbeat reply. See {@link HEARTBEAT_PING_FRAME}. */
export const HEARTBEAT_PONG_FRAME = '{"type":"heartbeat.pong"}';

/**
 * Recommended heartbeat cadence for a hosted deployment, in milliseconds.
 *
 * This lives beside the frame shapes because it is part of the same
 * client/host contract: a host that reclaims idle sessions must derive its
 * "is this session still live" window from the same cadence the client
 * actually pings at. Drifting the two apart is silent and expensive — if the
 * client's interval grows past the host's window, every still-open session
 * looks abandoned and gets reclaimed out from under a live connection.
 *
 * Both sides should import this rather than restating the number, so the
 * coupling is enforced by the compiler instead of by comments.
 *
 * @example
 * ```ts
 * // Client: ping on this cadence.
 * new WebSocketConnector({ url, heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS });
 *
 * // Host: treat a session touched within two beats as still live, which
 * // tolerates exactly one dropped or delayed heartbeat.
 * const livenessWindowMs = DEFAULT_HEARTBEAT_INTERVAL_MS * 2;
 * ```
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * True if `value` is a parsed `heartbeat.ping` frame.
 *
 * `value` must already be the result of `JSON.parse` on the raw wire
 * string — this does not parse JSON itself, so passing the raw string
 * (e.g. {@link HEARTBEAT_PING_FRAME}) always returns `false`.
 *
 * @example
 * ```ts
 * const parsed: unknown = JSON.parse(rawMessage);
 * if (isHeartbeatPingFrame(parsed)) {
 *   respondWithPong();
 * }
 * ```
 */
export function isHeartbeatPingFrame(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'heartbeat.ping'
  );
}

/**
 * True if `value` is a parsed `heartbeat.pong` frame. See {@link
 * isHeartbeatPingFrame} for the parsed-input requirement.
 *
 * A pong frame must never be routed through `decodeServerEnvelope` — it
 * carries no `id`/`sessionId`/protocol fields, so the envelope codec would
 * reject it as undecodable. Callers must intercept it with this guard
 * before it reaches the protocol decode path.
 *
 * @example
 * ```ts
 * const parsed: unknown = JSON.parse(rawMessage);
 * if (isHeartbeatPongFrame(parsed)) {
 *   return; // consumed transport-side; never decoded as a protocol envelope
 * }
 * const envelope = decodeServerEnvelope(rawMessage);
 * ```
 */
export function isHeartbeatPongFrame(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'heartbeat.pong'
  );
}
