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

## Host route responsibilities

The wrapping application route owns authentication, authorization, allowed
session configuration, HTTPS, and rate limits. Request schema validation does
not replace those controls. Cancelling an exchange cannot undo an upstream
session that has already been created.

## License

[MIT](./LICENSE)
