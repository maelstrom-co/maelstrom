/**
 * OpenAI wire contracts for the realtime mint boundary: the request the
 * browser sends to bootstrap a client-direct session, and the ephemeral
 * grant the mint endpoint returns. Consumed by `@maelstrom-co/realtime-openai`
 * on the browser side and `@maelstrom-co/realtime-openai-server` on the mint
 * side, so both sides validate against the exact same schema.
 */

export type { OpenAITokenGrant, OpenAITokenRequest } from './lib/openai-token.js';
export {
  OpenAITokenGrantSchema,
  OpenAITokenRequestSchema,
} from './lib/openai-token.js';
