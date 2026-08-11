/**
 * OpenAI wire contracts for the realtime mint boundary: the request the
 * browser sends to bootstrap a client-direct session, and the ephemeral
 * grant the mint endpoint returns. Consumed by `@maelstrom-co/realtime-openai`
 * on the browser side and `@maelstrom-co/realtime-openai-server` on the mint
 * side, so both sides validate against the exact same schema.
 */

/**
 * Built-in voice names accepted by both OpenAI Realtime output and greeting
 * TTS.
 *
 * Every member must remain supported by both APIs. Keep this union limited to
 * that intersection so a configured voice cannot succeed on one speech path
 * and fail on the other.
 */
export type OpenAIBuiltInVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'coral'
  | 'echo'
  | 'sage'
  | 'shimmer'
  | 'verse'
  | 'marin'
  | 'cedar';

export type {
  OpenAITokenGrant,
  OpenAITokenRequest,
} from './lib/openai-token.ts';
export {
  OpenAITokenGrantSchema,
  OpenAITokenRequestSchema,
} from './lib/openai-token.ts';
