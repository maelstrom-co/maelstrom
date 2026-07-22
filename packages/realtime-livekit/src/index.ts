/**
 * `@maelstrom-co/realtime-livekit` — a {@link RealtimeProviderAdapter} that
 * drives a LiveKit cascaded STT/TTS voice pipeline through the same
 * `RealtimeSession` machinery as the speech-native providers.
 *
 * Shipped as a package separate from `@maelstrom-co/realtime` so consumers of
 * the core never have `livekit-client` forced on them — pull this in only when
 * you want the LiveKit transport. The Node-only token minter lives in the
 * sibling `@maelstrom-co/realtime-livekit-server` package; the wire topic
 * constants re-exported on `./protocol` are shared with the
 * `@maelstrom-co/realtime-livekit-agent` worker.
 */
export { LiveKitAdapter } from './livekit-adapter.js';
export type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
export type { LiveKitTokenGrant } from './livekit-token.js';
export { LiveKitTokenGrantSchema } from './livekit-token.js';
export * from './protocol.js';
