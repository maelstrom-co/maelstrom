/**
 * `@maelstrom-co/realtime-livekit` — a {@link RealtimeProviderAdapter} that
 * drives a LiveKit cascaded STT/TTS voice pipeline through the same
 * `RealtimeSession` machinery as the speech-native providers.
 *
 * Shipped as a package separate from `@maelstrom-co/realtime` so consumers of
 * the core never have `livekit-client` forced on them — pull this in only when
 * you want the LiveKit transport. The Node-only token minter lives in the
 * sibling `@maelstrom-co/realtime-livekit-server` package; the wire contracts
 * re-exported here from `@maelstrom-co/realtime-protocol/livekit` are the same
 * ones the `@maelstrom-co/realtime-livekit-agent` worker imports directly, so
 * both sides read the exact same source of truth.
 */

export * from '@maelstrom-co/realtime-protocol/livekit';
export type {
  BrowserVadOptions,
  BrowserVadProviderOptions,
} from '@maelstrom-co/realtime-vad';
export { LiveKitAdapter } from './livekit-adapter.js';
export type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
