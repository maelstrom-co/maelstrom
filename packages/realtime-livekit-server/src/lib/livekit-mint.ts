import { err, ok, type Result } from '@maelstrom-co/protocol';
import type { MintFailure, UnixSeconds } from '@maelstrom-co/realtime';
import { USER_PARTICIPANT_IDENTITY } from '@maelstrom-co/realtime-livekit/protocol';
import {
  type LiveKitTokenGrant,
  LiveKitTokenGrantSchema,
} from '@maelstrom-co/realtime-livekit/token';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';

/**
 * What a caller passes {@link mintLiveKitToken} to scope a token to one room.
 * The package validates this request shape, while application transport retains
 * authentication, authorization, CSRF, origin, rate-limit, and trusted-scope
 * responsibilities.
 */
export interface LiveKitTokenRequest {
  /** Caller-provided room scope; validation trims surrounding whitespace before token scoping. */
  readonly roomName: string;
  /** Participant identity, defaulting to `"user"` when omitted. */
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

const DEFAULT_TTL = '15m';

/**
 * Mints a LiveKit access-token grant scoped to a single room + identity,
 * reading credentials from `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, the room
 * URL from `LIVEKIT_URL` (required — no default, so a deploy that omits it
 * fails closed rather than silently pointing every browser at localhost),
 * and the token lifetime from `LIVEKIT_TOKEN_TTL` (defaulting to `15m`).
 *
 * Result-based rather than throwing: a missing credential is a
 * `missing-api-key` failure and a malformed request an `invalid-request`
 * failure, so a misconfigured deploy surfaces a typed reason a transport can
 * map to a status instead of a raw throw. The returned grant carries
 * `expiresAt` (computed from the TTL), which describes when the JWT can no
 * longer authenticate an initial or fresh room connection. Token expiry is
 * checked for each such connection, including an explicit `connect()` after
 * `disconnect()`. It does not impact SDK-managed reconnects for an already
 * connected participant: LiveKit pushes refreshed tokens to connected clients,
 * and the SDK uses the refreshed token for managed reconnects. Expiry alone does
 * not disconnect an active participant or end the room. Each fresh `connect()`
 * invokes `mintToken`; the adapter does not schedule its own proactive renewal.
 * Expiry does not impose a maximum room duration or adapter cleanup. Production
 * hosts must enforce session-duration and cleanup policy independently.
 *
 * This mint operation is an **unauthenticated bootstrap**. Production transport
 * code must authenticate and authorize callers, enforce a trusted room and
 * identity policy instead of forwarding untrusted values, and add origin
 * controls, rate limits, and abuse controls before exposing the minter.
 * The example's imported authentication, CSRF, origin, shared rate-limit, and
 * telemetry functions are mandatory app-provided fail-closed controls; this
 * package does not implement them. `requireAuthenticatedVoiceSession`
 * authenticates and authorizes the request, binds the principal to trusted
 * session state, and derives room scope; it does not validate CSRF.
 * `isValidVoiceMintCsrf` is the only control in the example that validates the
 * CSRF proof. The controls must deny when policy cannot be evaluated and keep
 * raw failures inside the redacted telemetry boundary.
 *
 * Unlike the OpenAI minter there is no upstream HTTP call to inject a fake
 * `fetch` into: the JWT is signed locally, so tests exercise it by mocking
 * `livekit-server-sdk`.
 *
 * @example
 * ```ts
 * import { isErr } from '@maelstrom-co/protocol';
 * import {
 *   mintFailureHttpStatus,
 *   mintLiveKitToken,
 * } from '@maelstrom-co/realtime-livekit-server';
 * import { requireAuthenticatedVoiceSession } from './auth';
 * import {
 *   consumeVoiceMintRateLimit,
 *   isTrustedVoiceMintOrigin,
 *   isValidVoiceMintCsrf,
 * } from './voice-mint-policy';
 * import { reportRedactedVoiceMintFailure } from './redacted-telemetry';
 *
 * export async function POST(request: Request): Promise<Response> {
 *   const headers = { 'Cache-Control': 'private, no-store' };
 *   try {
 *     if (!isTrustedVoiceMintOrigin(request)) {
 *       return Response.json({ error: 'request-denied' }, { status: 403, headers });
 *     }
 *
 *     const session = await requireAuthenticatedVoiceSession(request);
 *     if (session === null) {
 *       return Response.json({ error: 'unauthorized' }, { status: 401, headers });
 *     }
 *
 *     if (!isValidVoiceMintCsrf(request, session)) {
 *       return Response.json({ error: 'request-denied' }, { status: 403, headers });
 *     }
 *
 *     const rateLimit = await consumeVoiceMintRateLimit(session.principalId);
 *     if (!rateLimit.allowed) {
 *       return Response.json(
 *         { error: 'rate-limited' },
 *         {
 *           status: 429,
 *           headers: { ...headers, 'Retry-After': String(rateLimit.retryAfterSeconds) },
 *         },
 *       );
 *     }
 *
 *     const result = await mintLiveKitToken({
 *       roomName: session.roomName,
 *       identity: session.identity,
 *     });
 *
 *     if (isErr(result)) {
 *       return Response.json(
 *         { error: 'mint-failed' },
 *         { status: mintFailureHttpStatus(result.error.reason), headers },
 *       );
 *     }
 *     return Response.json(result.value, { headers });
 *   } catch (error) {
 *     try {
 *       await reportRedactedVoiceMintFailure({
 *         source: 'livekit-token-route',
 *         error,
 *       });
 *     } catch {
 *       // Telemetry failure must not escape the HTTP boundary.
 *     }
 *     return Response.json(
 *       { error: 'mint-failed' },
 *       { status: 500, headers },
 *     );
 *   }
 * }
 * ```
 */
export async function mintLiveKitToken(
  input: unknown,
): Promise<LiveKitMintResult> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return err({ reason: 'missing-api-key' });
  }

  const request = LiveKitTokenRequestSchema.safeParse(input);
  if (!request.success) {
    return err({ reason: 'invalid-request' });
  }

  const url = process.env.LIVEKIT_URL;
  if (!url) {
    console.error(
      'LIVEKIT_URL is required (e.g. ws://localhost:7880 for local dev) — no default is assumed.',
    );
    return err({ reason: 'invalid-config' });
  }

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
      // Numeric seconds, not the raw env string: livekit-server-sdk only
      // appends a unit for a number-typed ttl — a string goes verbatim to
      // jose's parser, which requires a unit and throws on a bare integer
      // like the `900` this function's own error message recommends.
      ttl: ttlSeconds,
    });
    at.addGrant({
      roomJoin: true,
      room: request.data.roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    const expiresAt = (Math.floor(Date.now() / 1000) +
      ttlSeconds) as UnixSeconds;

    // Validate the built grant against the contract the browser adapter
    // expects — most commonly a right-shaped-but-wrong-scheme LIVEKIT_URL
    // (e.g. https://…), since room.connect() only speaks ws/wss — so a bad
    // grant fails here with a clear reason rather than reaching the browser and
    // failing opaquely there. Log the concrete zod issues: the parse can fail
    // on any of token/url/expiresAt, so a fixed scheme-assumption message would
    // misdirect an operator whenever some other field is at fault.
    const grant = LiveKitTokenGrantSchema.safeParse({ token, url, expiresAt });
    if (!grant.success) {
      console.error(
        `LiveKit token grant failed validation: ${JSON.stringify(grant.error.issues)}`,
      );
      return err({ reason: 'invalid-config' });
    }
    return ok(grant.data);
  } catch {
    return err({ reason: 'upstream-failure' });
  }
}

const TTL_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

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
    seconds =
      Number(match[1]) *
      TTL_UNIT_SECONDS[match[2] as keyof typeof TTL_UNIT_SECONDS];
  }
  // `Number.isSafeInteger` rejects both an Infinity from an over-long digit
  // string and a finite-but-unsafe product of `<int> * unit` — either would
  // yield a bogus `expiresAt` that slips past a bare `> 0` guard.
  return seconds > 0 && Number.isSafeInteger(seconds) ? seconds : null;
}
