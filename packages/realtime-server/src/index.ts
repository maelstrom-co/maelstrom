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
export type {
  CreateOpenAIMinterOptions,
  MintFailureReason,
  MintResult,
} from './lib/openai-mint.js';
export { createOpenAIMinter } from './lib/openai-mint.js';
