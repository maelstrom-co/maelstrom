# @maelstrom-co/realtime-openai-live-server

Server-only session exchange for OpenAI Live WebRTC. This package holds the
OpenAI project key and must never be imported into a browser bundle.

## Entry points

`createLiveSessionExchange(options)` returns a `LiveSessionExchange` function
that accepts an exchange request and an `AbortSignal`. It validates the request,
performs one upstream session-creation attempt, and validates the answer.
It rejects redirects and does not retry.

`LiveSessionExchangeOptions` accepts:

- `apiKey`: a non-empty, server-held OpenAI project key.
- `timeoutMs`: a positive timeout in milliseconds, defaulting to 30,000.
  The timeout includes reading the response body.
- `fetch`: an optional trusted fetch implementation that must honor redirect
  rejection.

The browser companion, `@maelstrom-co/realtime-openai-live`, receives the
exchange through a host-owned callback. Shared request and response schemas,
`LiveSessionExchange`, and `LiveTransportError` live at
`@maelstrom-co/realtime-protocol/openai-live`.

## Provide a host route

Install matching versions of `@maelstrom-co/realtime-openai-live-server` and
`@maelstrom-co/realtime-protocol` in your server. Mount the returned handler as
`POST /api/live-session`. Authentication and configuration approval are required
application functions, not permissive defaults:

```ts
import { createLiveSessionExchange } from '@maelstrom-co/realtime-openai-live-server';
import {
  LiveExchangeRequestSchema,
  type LiveSessionConfig,
} from '@maelstrom-co/realtime-protocol/openai-live';

export function createLiveRoute(options: {
  apiKey: string;
  origin: string;
  authorize: (request: Request) => Promise<boolean>;
  approveSession: (
    session: LiveSessionConfig,
    request: Request,
  ) => Promise<LiveSessionConfig | null>;
}) {
  const exchange = createLiveSessionExchange({ apiKey: options.apiKey });
  const headers = { 'Cache-Control': 'private, no-store' };
  return async function POST(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST')
        return Response.json({ error: 'method-not-allowed' }, { status: 405, headers });
      if (request.headers.get('Origin') !== options.origin ||
          !(await options.authorize(request)))
        return Response.json({ error: 'forbidden' }, { status: 403, headers });
      const offer = LiveExchangeRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!offer.success)
        return Response.json({ error: 'invalid-offer' }, { status: 400, headers });
      const session = await options.approveSession(offer.data.session, request);
      if (!session)
        return Response.json({ error: 'forbidden' }, { status: 403, headers });
      const answer = await exchange(
        { session, transport: offer.data.transport }, request.signal,
      );
      return Response.json(answer, { status: 201, headers });
    } catch {
      return Response.json({ error: 'live-unavailable' }, { status: 502, headers });
    }
  };
}
```

Load `apiKey` from server configuration and `origin` from a trusted, exact origin
such as `https://app.example.com`, never from the request's Host header.
`authorize` must authenticate the caller, check voice entitlement, and enforce
per-user/session spending limits. `approveSession` must reject or replace
caller-controlled models, tools, instructions, recording settings, and startup
context according to your app's policy; schema validation is not approval. Keep
approved Maelstrom tool definitions/backend instructions compatible with the
browser adapter. Do not blindly return the caller's session.

Enforce HTTPS, request-body byte limits and read deadlines, CSRF protections, and
rate limits in host middleware before this handler. The fragment is not a complete
authentication or abuse-protection implementation. Return stable errors and never
log offers, credentials, raw provider failures, or transcript context.

Pair this with the [browser example](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/#browser-adapter)
and the [Live setup and recovery guide](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/).

## Host route responsibilities

The wrapping application route owns authentication, authorization, allowed
session configuration, HTTPS, and rate limits. Request schema validation does
not replace those controls. Cancelling an exchange cannot undo an upstream
session that has already been created.

## License

[MIT](./LICENSE)
