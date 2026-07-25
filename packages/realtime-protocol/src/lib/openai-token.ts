import { type SessionId, SessionIdSchema } from '@maelstrom-co/protocol';
import { z } from 'zod';

import type { TokenGrant } from './token-grant.js';
import { UnixSecondsSchema } from './unix-seconds.js';

/**
 * What the browser sends to the OpenAI token-mint endpoint to bootstrap a
 * client-direct realtime session. Carries no secret — the mint endpoint holds
 * the provider key and returns an ephemeral credential.
 */
export interface OpenAITokenRequest {
  readonly provider: 'openai';
  /** Binds the minted session to the Maelstrom session for the sidechannel. */
  readonly sessionId: SessionId;
  /** Optional model override; the server picks a default when omitted. */
  readonly model?: string;
}

/**
 * Wire schema for {@link OpenAITokenRequest} — validates the request as it
 * crosses the browser → mint-endpoint boundary.
 *
 * - `sessionId` must satisfy {@link SessionIdSchema}, binding the request to
 *   a specific Maelstrom session.
 * - `model`, when present, must be non-empty: an empty string is rejected
 *   rather than treated as "omitted".
 */
export const OpenAITokenRequestSchema = z.object({
  provider: z.literal('openai'),
  sessionId: SessionIdSchema,
  model: z.string().min(1).optional(),
});

/**
 * The ephemeral OpenAI credential the browser uses to open the realtime
 * session directly. `value` is provider-opaque (an OpenAI `ek-…` client
 * secret) — the adapter, not this schema, interprets it.
 */
export interface OpenAITokenGrant extends TokenGrant {
  readonly provider: 'openai';
  readonly value: string;
  /**
   * The model the credential was minted for. Informational for the client —
   * the credential itself is already scoped to this model upstream.
   */
  readonly model: string;
}

/**
 * Wire schema for {@link OpenAITokenGrant} — validates the mint endpoint's
 * response as it crosses the server → browser boundary.
 *
 * - `value` must be a non-empty string (the opaque provider credential).
 * - `expiresAt` must satisfy {@link UnixSecondsSchema}.
 * - `model` must be a non-empty string.
 */
export const OpenAITokenGrantSchema = z.object({
  provider: z.literal('openai'),
  value: z.string().min(1),
  expiresAt: UnixSecondsSchema,
  model: z.string().min(1),
});

// Schema <-> type parity guards: a drift between either shape becomes a
// compile error rather than a runtime surprise at the wire boundary.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type _InferredRequest = z.infer<typeof OpenAITokenRequestSchema>;
const _reqFwd: _InferredRequest extends Mutable<OpenAITokenRequest>
  ? true
  : false = true;
const _reqBwd: Mutable<OpenAITokenRequest> extends _InferredRequest
  ? true
  : false = true;

type _InferredGrant = z.infer<typeof OpenAITokenGrantSchema>;
const _grantFwd: _InferredGrant extends Mutable<OpenAITokenGrant>
  ? true
  : false = true;
const _grantBwd: Mutable<OpenAITokenGrant> extends _InferredGrant
  ? true
  : false = true;

void [_reqFwd, _reqBwd, _grantFwd, _grantBwd];
