/**
 * `@maelstrom-co/realtime-server` — server-only handlers for minting
 * ephemeral realtime provider credentials.
 *
 * This is the only Maelstrom package that touches a raw provider API key
 * (e.g. `OPENAI_API_KEY`). Handlers here run in a server context and hand
 * the browser a short-lived, provider-scoped credential instead — see
 * {@link createOpenAiMintHandler} for the OpenAI implementation.
 */
export type { CreateOpenAiMintHandlerOptions } from './lib/openai-mint.js';
export { createOpenAiMintHandler } from './lib/openai-mint.js';
