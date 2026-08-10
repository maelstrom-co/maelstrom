/**
 * The LiveKit room wire contract on its own: data/text-stream topics, the
 * participant identity, and the message shapes the browser adapter and the
 * `@maelstrom-co/realtime-livekit-agent` worker exchange over the room.
 *
 * Separate from `@maelstrom-co/realtime-protocol/livekit` because that subpath
 * also aggregates `LiveKitTokenGrantSchema`, which pulls in zod. The worker
 * needs four topic strings and nothing else, so it imports this subpath and
 * loads no schema runtime at boot. Anything added here must keep that
 * property — `layer-boundary.test.ts` pins it.
 */

export * from './lib/livekit-wire.ts';
