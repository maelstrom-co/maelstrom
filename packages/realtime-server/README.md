# @maelstrom-co/realtime-server

Server-only handlers for minting ephemeral realtime provider credentials.

This is the only Maelstrom package that touches raw provider API keys
(e.g. `OPENAI_API_KEY`). It never ships to the browser.

## Install

```bash
bun add @maelstrom-co/realtime-server @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime-server @maelstrom-co/protocol`

## What it does

- `createOpenAIMinter` — a transport-agnostic `(input: unknown) => Promise<MintResult>`
  that exchanges a server-held `OPENAI_API_KEY` for a short-lived client
  secret via OpenAI's `client_secrets` endpoint, so the browser never sees
  the long-lived key. `input` is the already-parsed request body; wiring it
  into an HTTP route (method checks, JSON parsing, status codes) is your
  transport's job.
- `mintFailureHttpStatus` — a suggested `MintFailureReason -> HTTP status`
  mapping for transports that don't want to hand-roll one. Optional: this
  package stays transport-agnostic, so nothing requires using it.

## Quick example

```ts
import { isOk } from '@maelstrom-co/protocol';
import { createOpenAIMinter, mintFailureHttpStatus } from '@maelstrom-co/realtime-server';
import { requireAuthenticatedRealtimeSession } from './auth';
import {
  areRealtimeMintAuthAndCsrfCheapAndConstantTime,
  consumeRealtimeMintPreAuthRateLimit,
  consumeRealtimeMintRateLimit,
  isTrustedRealtimeMintOrigin,
  isValidRealtimeMintCsrf,
  resolveTrustedRealtimeMintClientAddress,
  resolveAllowedRealtimeModel,
} from './realtime-mint-policy';
import { reportRedactedRealtimeMintFailure } from './redacted-telemetry';

const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-realtime-2',
});
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isTrustedRealtimeMintOrigin(request)) {
      return Response.json({ error: 'request-denied' }, { status: 403, headers });
    }

    if (!areRealtimeMintAuthAndCsrfCheapAndConstantTime()) {
      const clientAddress = resolveTrustedRealtimeMintClientAddress(request);
      if (clientAddress === null) {
        return Response.json({ error: 'request-denied' }, { status: 403, headers });
      }

      const preAuthRateLimit =
        await consumeRealtimeMintPreAuthRateLimit(clientAddress);
      if (!preAuthRateLimit.allowed) {
        return Response.json(
          { error: 'rate-limited' },
          {
            status: 429,
            headers: {
              ...headers,
              'Retry-After': String(preAuthRateLimit.retryAfterSeconds),
            },
          },
        );
      }
    }

    const authenticated = await requireAuthenticatedRealtimeSession(request);
    if (authenticated === null) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    }

    if (!isValidRealtimeMintCsrf(request, authenticated)) {
      return Response.json({ error: 'request-denied' }, { status: 403, headers });
    }

    const rateLimit = await consumeRealtimeMintRateLimit(
      authenticated.principalId,
    );
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

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return Response.json(
        { error: 'invalid-request' },
        { status: 400, headers },
      );
    }

    const model = resolveAllowedRealtimeModel(authenticated, input);
    if (model === null) {
      return Response.json({ error: 'request-denied' }, { status: 403, headers });
    }

    const result = await mint({
      provider: 'openai',
      sessionId: authenticated.sessionId,
      model,
    });
    if (isOk(result)) return Response.json(result.value, { headers });

    return Response.json(
      { error: 'mint-failed' },
      { status: mintFailureHttpStatus(result.error.reason), headers },
    );
  } catch (error) {
    try {
      await reportRedactedRealtimeMintFailure({
        source: 'openai-token-route',
        error,
      });
    } catch {
      // Telemetry failure must not escape the HTTP boundary.
    }
    return Response.json({ error: 'mint-failed' }, { status: 500, headers });
  }
}
```

This mint operation is an unauthenticated bootstrap. The imported
authentication, CSRF, origin, model-policy, shared rate-limit, and telemetry
functions are mandatory app-provided fail-closed controls; this package does
not implement them. Keep the exact server-side origin allowlist check first.
When authentication and CSRF validation are not demonstrably cheap and
constant-time, run the app-provided fail-closed pre-auth transport throttle
before both controls. Key that throttle from a trusted server- or proxy-derived
IP-equivalent client address. Reject browser-controlled forwarding headers
rather than treating them as trusted address data.

`requireAuthenticatedRealtimeSession` authenticates and authorizes the request,
binds `principalId` and `sessionId` to trusted server state, and does not
validate CSRF. `isValidRealtimeMintCsrf` alone validates the application's CSRF
proof. Retain `consumeRealtimeMintRateLimit` as a shared principal-keyed limit
after authentication and CSRF validation; it must atomically consume the limit.
Both the pre-auth transport throttle and the retained principal throttle must
deny on store failure, return a bounded retry delay, and use the same generic
429 body. `resolveAllowedRealtimeModel` may select only from a server-derived
allowlist; browser input must never define or widen model policy.

The POST route uses stable public bodies and `Cache-Control: private, no-store`
for success, denials, malformed JSON, mapped mint failures, and unexpected
exceptions. `mintFailureHttpStatus` maps only the HTTP status. Never return or
log `MintFailureReason`, credential diagnostics, raw exceptions, request bodies,
or session data; send unexpected failures only to redacted telemetry.

OpenAI recommends an `OpenAI-Safety-Identifier` header for client-secret
creation. `createOpenAIMinter` does not currently expose a public
upstream-header option, so adding that support remains a follow-up.

## Docs

- OpenAI Realtime guide: https://docs.maelstrom-ai.co/guides/voice/openai-realtime/
- Package API reference: https://docs.maelstrom-ai.co/reference/realtime-server/readme/
- OpenAI Realtime WebRTC guide: https://platform.openai.com/docs/guides/realtime-webrtc
- OpenAI Realtime guide: https://platform.openai.com/docs/guides/realtime

## License

MIT
