# @maelstrom-co/realtime-livekit-server

Server-only handler for minting LiveKit room access tokens.

The server sibling of `@maelstrom-co/realtime-livekit`: the browser package
declares the `LiveKitTokenGrant` contract the adapter consumes, and this
package implements it. It is the only side that touches
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, and it never ships to the browser.

## Install

```bash
bun add @maelstrom-co/realtime-livekit-server @maelstrom-co/realtime-livekit
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime-livekit-server @maelstrom-co/realtime-livekit`

## What it does

- `mintLiveKitToken` — a `(input: unknown) => Promise<LiveKitMintResult>` that
  signs a LiveKit room JWT scoped to a room + identity, reading credentials
  and the token TTL from `LIVEKIT_*` env vars. The minter owns only request
  shape validation and local provider interaction; application transport owns
  authentication, authorization, CSRF, origin checks, shared rate limits, and
  trusted room scope. The returned grant carries
  `expiresAt`. Token expiry is checked for each initial or fresh room connection,
  including an explicit `connect()` after `disconnect()`. It does not impact
  SDK-managed reconnects for an already connected participant because LiveKit
  pushes refreshed tokens to connected clients, and the SDK uses the refreshed
  token for managed reconnects. Expiry alone does not disconnect an active
  participant or end the room. Each fresh `connect()` invokes `mintToken`.
- `mintFailureHttpStatus` — a suggested `MintFailureReason -> HTTP status`
  mapping, re-exported from `@maelstrom-co/realtime` for callers wiring the
  minter into an HTTP transport.

## Quick example

```ts
import { isErr } from '@maelstrom-co/protocol';
import {
  mintFailureHttpStatus,
  mintLiveKitToken,
} from '@maelstrom-co/realtime-livekit-server';
import { requireAuthenticatedVoiceSession } from './auth';
import {
  consumeVoiceMintRateLimit,
  isTrustedVoiceMintOrigin,
  isValidVoiceMintCsrf,
} from './voice-mint-policy';
import { reportRedactedVoiceMintFailure } from './redacted-telemetry';

export async function POST(request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    if (!isTrustedVoiceMintOrigin(request)) {
      return Response.json({ error: 'request-denied' }, { status: 403, headers });
    }

    const authenticated = await requireAuthenticatedVoiceSession(request);
    if (authenticated === null) {
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers },
      );
    }

    if (!isValidVoiceMintCsrf(request, authenticated)) {
      return Response.json({ error: 'request-denied' }, { status: 403, headers });
    }

    const rateLimit = await consumeVoiceMintRateLimit(authenticated.principalId);
    if (!rateLimit.allowed) {
      return Response.json(
        { error: 'rate-limited' },
        {
          status: 429,
          headers: {
            ...headers,
            'Retry-After': String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const result = await mintLiveKitToken({
      roomName: authenticated.roomName,
      identity: authenticated.identity,
    });

    if (isErr(result)) {
      return Response.json(
        { error: 'mint-failed' },
        { status: mintFailureHttpStatus(result.error.reason), headers },
      );
    }
    return Response.json(result.value, { headers });
  } catch (error) {
    try {
      await reportRedactedVoiceMintFailure({
        source: 'livekit-token-route',
        error,
      });
    } catch {
      // Telemetry failure must not escape the HTTP boundary.
    }
    return Response.json(
      { error: 'mint-failed' },
      { status: 500, headers },
    );
  }
}
```

`mintLiveKitToken` validates request shape only — it performs no authentication
or authorization. The imported authentication, CSRF, origin, shared rate-limit,
and telemetry functions are mandatory app-provided fail-closed controls; the
package does not implement them. `requireAuthenticatedVoiceSession` must return
`null` on authentication or authorization denial, bind the principal to the
trusted server session, and derive room scope from that session. It does not
validate CSRF.
`isTrustedVoiceMintOrigin` must validate `Origin` against an exact allowlist and
return `false` when policy cannot be evaluated. `isValidVoiceMintCsrf` must
be the only control in this example that validates the application's CSRF proof
against the authenticated session, returning `false` when the proof or policy is
invalid. `consumeVoiceMintRateLimit` must atomically consume from a shared limit
keyed by the authenticated principal, return a bounded retry delay, and deny on
store failure. None may accept policy keys or room scope from browser input.

The outer `try` covers every helper and the minter. Unexpected exceptions are
reported only through `reportRedactedVoiceMintFailure`, which must emit only
allowlisted metadata and discard raw messages, stacks, credentials, token
contents, request bodies, and session data. A telemetry failure must not escape
the route. Every success, denial, mapped mint failure, and unexpected exception
uses `Cache-Control: private, no-store`; no response body exposes an internal
mint failure reason. Keep `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET` in server-only configuration.

The minter's room grant contains only `roomJoin`, the server-derived `room`,
`canPublish`, and `canSubscribe`. It does not grant room administration,
recording, ingress, egress, or access to another room. The token and managed
reconnect behavior documented here is scoped to the repository's locked
`livekit-server-sdk` and `livekit-client` 2.13.1 releases.

> **Development-only demo route:** The repository demo mint route at
> `apps/demo/src/lib/voice/get-livekit-token.ts` currently lacks production
> authentication, trusted scope derivation, and explicit no-store cache headers.
> Do not deploy it; use the hardened authenticated POST route above.

## Docs

- Production guide: https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/
- Voice overview: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime-livekit-server/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/
- LiveKit token generation: https://docs.livekit.io/home/server/generating-tokens/
- LiveKit voice AI worker guide: https://docs.livekit.io/agents/start/voice-ai/

## License

MIT
