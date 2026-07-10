import { z } from 'zod';
import { SessionIdSchema, type SessionId } from './session.js';
import type { Mutable } from './_drift-guards.js';

// --- provider ---

/** Wire schema for the realtime providers Maelstrom can mint a client-direct session token for. */
export const RealtimeProviderSchema = z.enum(['openai', 'google']);

/** Realtime providers Maelstrom can mint a client-direct session token for. */
export type RealtimeProvider = z.infer<typeof RealtimeProviderSchema>;

// --- mint request (browser -> mint endpoint) ---

/**
 * What the browser sends to the token-mint endpoint to bootstrap a
 * client-direct realtime session. Carries no secret — the mint endpoint
 * holds the provider key and returns an ephemeral credential.
 */
export interface TokenHandshakeRequest {
  readonly provider: RealtimeProvider;
  /** Binds the minted session to the Maelstrom session for the sidechannel. */
  readonly sessionId: SessionId;
  /** Optional model override; the server picks a default per provider. */
  readonly model?: string;
}

/** Wire schema for {@link TokenHandshakeRequest}. */
export const TokenHandshakeRequestSchema = z.object({
  provider: RealtimeProviderSchema,
  sessionId: SessionIdSchema,
  model: z.string().min(1).optional(),
});

// --- mint response (mint endpoint -> browser) ---

/**
 * The ephemeral credential the browser uses to open the provider session
 * directly. `value` is provider-opaque (OpenAI `ek-…` client secret, or a
 * Gemini ephemeral token name) — the adapter, not this schema, interprets it.
 */
export interface TokenHandshakeResponse {
  readonly provider: RealtimeProvider;
  readonly value: string;
  /** Unix seconds at which `value` expires. */
  readonly expiresAt: number;
  /**
   * The model the credential was minted for. Informational for the client —
   * the credential itself is already scoped to this model upstream.
   */
  readonly model: string;
}

/** Wire schema for {@link TokenHandshakeResponse}. */
export const TokenHandshakeResponseSchema = z.object({
  provider: RealtimeProviderSchema,
  value: z.string().min(1),
  expiresAt: z.number().int().positive(),
  model: z.string().min(1),
});

// --- drift guards ---

type _InferredTokenHandshakeRequest = z.infer<typeof TokenHandshakeRequestSchema>;
const _tokenHandshakeReqFwd: _InferredTokenHandshakeRequest extends Mutable<TokenHandshakeRequest>
  ? true
  : false = true;
const _tokenHandshakeReqBwd: Mutable<TokenHandshakeRequest> extends _InferredTokenHandshakeRequest
  ? true
  : false = true;

type _InferredTokenHandshakeResponse = z.infer<typeof TokenHandshakeResponseSchema>;
const _tokenHandshakeRespFwd: _InferredTokenHandshakeResponse extends Mutable<TokenHandshakeResponse>
  ? true
  : false = true;
const _tokenHandshakeRespBwd: Mutable<TokenHandshakeResponse> extends _InferredTokenHandshakeResponse
  ? true
  : false = true;

void [_tokenHandshakeReqFwd, _tokenHandshakeReqBwd, _tokenHandshakeRespFwd, _tokenHandshakeRespBwd];
