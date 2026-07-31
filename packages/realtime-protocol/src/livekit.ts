/**
 * LiveKit wire contracts shared by every side of the LiveKit voice pipeline:
 * the token grant the mint endpoint returns (`@maelstrom-co/realtime-livekit`
 * on the browser side, `@maelstrom-co/realtime-livekit-server` on the mint
 * side), and the data/text-stream topic constants and message shapes the
 * browser adapter and the `@maelstrom-co/realtime-livekit-agent` worker use
 * to talk to each other over the room. Zero runtime behavior — this is the
 * single source of truth all three packages read so the wire shapes can
 * never drift.
 */

export type { LiveKitTokenGrant } from './lib/livekit-token.ts';
export { LiveKitTokenGrantSchema } from './lib/livekit-token.ts';
export * from './lib/livekit-wire.ts';
