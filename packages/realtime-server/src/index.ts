/**
 * `@maelstrom-co/realtime-server` — server-only, transport-agnostic logic
 * for minting ephemeral realtime provider credentials.
 *
 * This is the only Maelstrom package that touches a raw provider API key
 * (e.g. `OPENAI_API_KEY`). Minters here run in a server context and hand
 * the browser a short-lived, provider-scoped credential instead — see
 * {@link createOpenAIMinter} for the OpenAI implementation. Wiring a minter
 * into an HTTP route (method checks, body parsing, status codes) is the
 * caller's responsibility.
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
