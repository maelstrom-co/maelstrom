import type { UnixSeconds } from './unix-seconds.js';

/**
 * Open base contract for an ephemeral, client-direct realtime credential.
 *
 * Deliberately minimal — it carries only `expiresAt`, the one field every
 * transport shares so a client can refresh a grant proactively before it
 * lapses. Each provider adapter declares its own grant by
 * extending this with the provider-opaque credential fields it needs (an
 * OpenAI client secret, a LiveKit room JWT + URL, …). Keeping the union open
 * means a third-party adapter can ship a new grant shape without editing any
 * shared package.
 */
export interface TokenGrant {
  /** Absolute Unix-epoch second at which the credential expires. */
  readonly expiresAt: UnixSeconds;
}
