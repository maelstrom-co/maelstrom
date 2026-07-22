import { type Result, err, ok } from '@maelstrom-co/protocol';
import type { MintFailure, UnixSeconds } from '@maelstrom-co/realtime';
import type { LiveKitTokenGrant } from '@maelstrom-co/realtime-livekit';
import { USER_PARTICIPANT_IDENTITY } from '@maelstrom-co/realtime-livekit/protocol';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';

/**
 * What a caller passes {@link mintLiveKitToken} to scope a token to one room.
 * Validated in-package so the trust boundary lives with the minter rather
 * than each consuming app.
 */
export interface LiveKitTokenRequest {
  readonly roomName: string;
  readonly identity?: string;
}

/** Wire schema for {@link LiveKitTokenRequest}. */
export const LiveKitTokenRequestSchema = z.object({
  // Trim (not just validate) so the minted token always matches the trimmed
  // room name a caller sees elsewhere — untrimmed whitespace variants never
  // diverge into a token scoped to a different room string.
  roomName: z.string().trim().min(1),
  identity: z.string().min(1).optional(),
});

/** Outcome of a {@link mintLiveKitToken} call. */
export type LiveKitMintResult = Result<LiveKitTokenGrant, MintFailure>;

const DEFAULT_URL = 'ws://localhost:7880';
const DEFAULT_TTL = '15m';

/**
 * Mints a LiveKit access-token grant scoped to a single room + identity,
 * reading credentials from `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, the room
 * URL from `LIVEKIT_URL` (defaulting to a local dev server), and the token
 * lifetime from `LIVEKIT_TOKEN_TTL` (defaulting to `15m`).
 *
 * Result-based rather than throwing: a missing credential is a
 * `missing-api-key` failure and a malformed request an `invalid-request`
 * failure, so a misconfigured deploy surfaces a typed reason a transport can
 * map to a status instead of a raw throw. The returned grant carries
 * `expiresAt` (computed from the TTL) so the browser can refresh proactively
 * before the JWT lapses — the TTL is a server-side env the client can't
 * otherwise see. Unlike the OpenAI minter there is no upstream HTTP call to
 * inject a fake `fetch` into: the JWT is signed locally, so tests exercise it
 * by mocking `livekit-server-sdk`.
 *
 * @example
 * ```ts
 * // In a TanStack Start server fn:
 * import { isErr } from '@maelstrom-co/protocol';
 * import { mintLiveKitToken } from '@maelstrom-co/realtime-livekit-server';
 *
 * export const getLivekitToken = createServerFn({ method: 'GET' })
 *   .inputValidator((d: unknown) => d)
 *   .handler(async ({ data }) => {
 *     const result = await mintLiveKitToken(data);
 *     if (isErr(result)) throw new Error(result.error.reason);
 *     return result.value;
 *   });
 * ```
 */
export async function mintLiveKitToken(input: unknown): Promise<LiveKitMintResult> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return err({ reason: 'missing-api-key' });
  }

  const request = LiveKitTokenRequestSchema.safeParse(input);
  if (!request.success) {
    return err({ reason: 'invalid-request' });
  }

  const url = process.env.LIVEKIT_URL ?? DEFAULT_URL;
  const ttl = process.env.LIVEKIT_TOKEN_TTL ?? DEFAULT_TTL;

  // Fail closed on a TTL this package can't confidently parse: the SDK accepts
  // the wider vercel/ms grammar (e.g. `2 days`, `1w`), but the local parser
  // that computes `expiresAt` does not, so minting anyway would report an
  // expiry that silently diverges from the real JWT lifetime. Reject before
  // signing rather than emit a mismatched grant. `invalid-config` is the
  // shared vocabulary's reason for a present-but-invalid env setting (HTTP
  // 500) — the credentials are fine, so `missing-api-key` would misdirect an
  // operator into checking the wrong thing.
  const ttlSeconds = ttlToSeconds(ttl);
  if (ttlSeconds === null) {
    console.error(
      `LIVEKIT_TOKEN_TTL="${ttl}" is not a supported token lifetime. Use a ` +
        'positive number of seconds (e.g. 900) or <int><unit> with unit s/m/h/d ' +
        '(e.g. 15m, 2h, 7d).',
    );
    return err({ reason: 'invalid-config' });
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: request.data.identity ?? USER_PARTICIPANT_IDENTITY,
      ttl,
    });
    at.addGrant({
      roomJoin: true,
      room: request.data.roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    const expiresAt = (Math.floor(Date.now() / 1000) + ttlSeconds) as UnixSeconds;
    return ok({ token, url, expiresAt });
  } catch {
    return err({ reason: 'upstream-failure' });
  }
}

const TTL_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

// `expiresAt` needs the absolute expiry, so parse the TTL the same way here.
// Deliberately narrower than the SDK's vercel/ms grammar: only a bare integer
// number of seconds or a single `<int><unit>` string (unit s/m/h/d) is
// supported. Returns null for anything else — including a zero-valued TTL (a
// token expiring immediately is useless, near-certain misconfiguration) — so
// the caller fails closed rather than reporting a guessed expiry that diverges
// from the JWT the SDK actually signs.
function ttlToSeconds(ttl: string): number | null {
  const trimmed = ttl.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const match = /^(\d+)([smhd])$/.exec(trimmed);
    if (!match) return null;
    seconds = Number(match[1]) * TTL_UNIT_SECONDS[match[2] as keyof typeof TTL_UNIT_SECONDS];
  }
  return seconds > 0 ? seconds : null;
}
