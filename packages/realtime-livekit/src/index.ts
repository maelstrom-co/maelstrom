/**
 * `@maelstrom-co/realtime-livekit` — a {@link RealtimeProviderAdapter} that
 * drives a LiveKit cascaded STT/TTS voice pipeline through the same
 * `RealtimeSession` machinery as the speech-native providers.
 *
 * Shipped as a package separate from `@maelstrom-co/realtime` so consumers of
 * the core never have `livekit-client` forced on them — pull this in only when
 * you want the LiveKit transport. The Node-only token minter lives on the
 * `./server` subpath; the wire topic constants on `./protocol` (shared with the
 * `@maelstrom-co/realtime-livekit-agent` worker).
 */
export { LiveKitAdapter } from './livekit-adapter.js';
export type {
  LiveKitAdapterOptions,
  LiveKitTokenGrant,
} from './livekit-adapter.types.js';
export * from './protocol.js';
