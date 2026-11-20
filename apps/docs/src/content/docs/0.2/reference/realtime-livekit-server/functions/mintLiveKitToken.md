---
editUrl: false
next: false
prev: false
title: "mintLiveKitToken"
---

> **mintLiveKitToken**(`input`): `Promise`\<[`LiveKitMintResult`](/reference/realtime-livekit-server/type-aliases/livekitmintresult/)\>

Defined in: packages/realtime-livekit-server/src/lib/livekit-mint.ts:148

Mints a LiveKit access-token grant scoped to a single room + identity,
reading credentials from `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, the room
URL from `LIVEKIT_URL` (required — no default, so a deploy that omits it
fails closed rather than silently pointing every browser at localhost),
and the token lifetime from `LIVEKIT_TOKEN_TTL` (defaulting to `15m`).

Result-based rather than throwing: a missing credential is a
`missing-api-key` failure and a malformed request an `invalid-request`
failure, so a misconfigured deploy surfaces a typed reason a transport can
map to a status instead of a raw throw. The returned grant carries
`expiresAt` (computed from the TTL), which describes when the JWT can no
longer authenticate an initial or fresh room connection. Token expiry is
checked for each such connection, including an explicit `connect()` after
`disconnect()`. It does not impact SDK-managed reconnects for an already
connected participant: LiveKit pushes refreshed tokens to connected clients,
and the SDK uses the refreshed token for managed reconnects. Expiry alone does
not disconnect an active participant or end the room. Each fresh `connect()`
invokes `mintToken`; the adapter does not schedule its own proactive renewal.
Expiry does not impose a maximum room duration or adapter cleanup. Production
hosts must enforce session-duration and cleanup policy independently.

This mint operation is an **unauthenticated bootstrap**. Production transport
code must authenticate and authorize callers, enforce a trusted room and
identity policy instead of forwarding untrusted values, and add origin
controls, rate limits, and abuse controls before exposing the minter.
The example's imported authentication, CSRF, origin, shared rate-limit, and
telemetry functions are mandatory app-provided fail-closed controls; this
package does not implement them. `requireAuthenticatedVoiceSession`
authenticates and authorizes the request, binds the principal to trusted
session state, and derives room scope; it does not validate CSRF.
`isValidVoiceMintCsrf` is the only control in the example that validates the
CSRF proof. The controls must deny when policy cannot be evaluated and keep
raw failures inside the redacted telemetry boundary.

Unlike the OpenAI minter there is no upstream HTTP call to inject a fake
`fetch` into: the JWT is signed locally, so tests exercise it by mocking
`livekit-server-sdk`.

## Parameters

### input

`unknown`

## Returns

`Promise`\<[`LiveKitMintResult`](/reference/realtime-livekit-server/type-aliases/livekitmintresult/)\>

## Example

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

    const session = await requireAuthenticatedVoiceSession(request);
    if (session === null) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    }

    if (!isValidVoiceMintCsrf(request, session)) {
      return Response.json({ error: 'request-denied' }, { status: 403, headers });
    }

    const rateLimit = await consumeVoiceMintRateLimit(session.principalId);
    if (!rateLimit.allowed) {
      return Response.json(
        { error: 'rate-limited' },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const result = await mintLiveKitToken({
      roomName: session.roomName,
      identity: session.identity,
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
