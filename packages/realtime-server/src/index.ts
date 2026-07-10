/**
 * `@maelstrom-co/realtime-server` — server-only handlers for minting
 * ephemeral realtime provider credentials.
 *
 * This is the only Maelstrom package that touches a raw provider API key
 * (e.g. `OPENAI_API_KEY`). Handlers here run in a server context and hand
 * the browser a short-lived, provider-scoped credential instead — see
 * {@link createOpenAIMintHandler} for the OpenAI implementation.
 */
export type { CreateOpenAIMintHandlerOptions } from './lib/openai-mint.js';
export { createOpenAIMintHandler } from './lib/openai-mint.js';
