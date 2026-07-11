/**
 * Wire shape of the WebSocket heartbeat mechanism ({@link
 * WebSocketConnectorOptions.heartbeatIntervalMs}). These frames are
 * transport-level — not part of the `@maelstrom-co/protocol` envelope union
 * — so a host answering the heartbeat (e.g. a hosted deployment's server)
 * must match this shape exactly rather than reimplementing it from memory.
 */
export const HEARTBEAT_PING_FRAME = '{"type":"heartbeat.ping"}';

/** Wire shape of the heartbeat reply. See {@link HEARTBEAT_PING_FRAME}. */
export const HEARTBEAT_PONG_FRAME = '{"type":"heartbeat.pong"}';

/** True if `value` is a parsed `heartbeat.ping` frame. See {@link HEARTBEAT_PING_FRAME}. */
export function isHeartbeatPingFrame(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'heartbeat.ping'
  );
}

/** True if `value` is a parsed `heartbeat.pong` frame. See {@link HEARTBEAT_PING_FRAME}. */
export function isHeartbeatPongFrame(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'heartbeat.pong'
  );
}
