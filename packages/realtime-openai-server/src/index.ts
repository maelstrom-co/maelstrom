/**
 * `@maelstrom-co/realtime-openai-server` — server-only, transport-agnostic
 * logic for minting ephemeral OpenAI realtime client secrets.
 *
 * The server sibling of `@maelstrom-co/realtime-openai`, exactly as
 * `@maelstrom-co/realtime-livekit-server` is the server sibling of
 * `@maelstrom-co/realtime-livekit`: it is the only side that touches the raw
 * `OPENAI_API_KEY`, and it never ships to the browser. The browser adapter
 * gets a short-lived, provider-scoped credential instead — see
 * {@link createOpenAIMinter}. Wiring a minter into an HTTP route (method
 * checks, body parsing, status codes) is the caller's responsibility.
 */

// The shared mint vocabulary lives in `@maelstrom-co/realtime-protocol` (the
// dependency-free contract leaf both the browser and server sides depend on);
// re-exported here so a consumer wiring an OpenAI mint route pulls everything
// it needs from one entry point.
export type {
  MintFailure,
  MintFailureReason,
} from '@maelstrom-co/realtime-protocol';
export { mintFailureHttpStatus } from '@maelstrom-co/realtime-protocol';
export type {
  CreateOpenAIMinterOptions,
  MintResult,
} from './lib/openai-mint.js';
export { createOpenAIMinter } from './lib/openai-mint.js';
