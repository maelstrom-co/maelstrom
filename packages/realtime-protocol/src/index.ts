/**
 * `@maelstrom-co/realtime-protocol` — dependency-free wire contracts for
 * Maelstrom's realtime voice packages.
 *
 * Contracts are subpaths, implementations are packages: this leaf holds only
 * types, zod schemas, and constants — zero runtime behavior, no browser or
 * Node APIs. Both the browser-side packages (`@maelstrom-co/realtime`,
 * `@maelstrom-co/realtime-openai`, `@maelstrom-co/realtime-livekit`) and the
 * server/worker-side ones (`@maelstrom-co/realtime-openai-server`,
 * `@maelstrom-co/realtime-livekit-server`,
 * `@maelstrom-co/realtime-livekit-agent`) depend on it, so a Node-only mint
 * package never has to pull in a browser SDK just to see the shared
 * vocabulary. This barrel carries the provider-neutral mint vocabulary;
 * provider-specific wire contracts live behind `./openai` and `./livekit` —
 * import from those entry points, not this barrel, to pull one in.
 */

export type {
  MintFailure,
  MintFailureReason,
  MintFetch,
} from './lib/mint.js';
export { MINT_FAILURE_REASONS, mintFailureHttpStatus } from './lib/mint.js';
export type { TokenGrant } from './lib/token-grant.js';
export type { UnixSeconds } from './lib/unix-seconds.js';
export { UnixSecondsSchema } from './lib/unix-seconds.js';
