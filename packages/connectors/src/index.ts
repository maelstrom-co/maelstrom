/**
 * Transport-level connection contracts shared by Maelstrom clients and
 * engine hosts.
 *
 * A client connector and the server that answers it must agree on wire-level
 * details the protocol envelope union deliberately does not cover: heartbeat
 * frame shapes, what a close code means for reconnect, and when a parsed id
 * may drive request correlation. This package is that agreement. It is a
 * contract-layer leaf (it depends on nothing but `@maelstrom-co/protocol`),
 * so both browser and server packages import it directly instead of one of
 * them reaching across the layer boundary.
 */

export type { CloseCodeClassification } from './close-code.js';
export { classifyCloseCode } from './close-code.js';
export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
  isHeartbeatPingFrame,
  isHeartbeatPongFrame,
} from './heartbeat-frame.js';
export { isCorrelatableId } from './utils.js';
