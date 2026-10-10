# @maelstrom-co/realtime-openai-live

Browser WebRTC transport and Maelstrom UI tool integration for OpenAI Live.

## Entry points

- `OpenAILiveAdapter` connects managed Live Responses to `RealtimeSession`.
  It handles UI tool results and grounding, and exposes continuous transcript
  and media observations without treating fragments as completed turns.
- `OpenAILiveTransport` provides the WebRTC lifecycle and provider observations
  without the Maelstrom UI tool integration. It does not reconnect automatically
  or replay commands.
- `OpenAILiveAdapterOptions`, `LiveTransportOptions`, and
  `LiveTransportSnapshot` describe configuration and retained transport state.

Both implementations receive a host-owned `exchange` callback for the SDP
exchange. The companion `@maelstrom-co/realtime-openai-live-server` package
performs the upstream exchange with a server-held OpenAI key. Never pass a
provider key to the browser.

Shared wire types and schemas live at
`@maelstrom-co/realtime-protocol/openai-live`.

## Inspect projected provider diagnostics

The adapter and transport expose an optional `diagnostics` feed. Subscribing
observes subsequent projected native receipts and successful sends. It does not
connect the transport or acquire media. Diagnostic observer failures remain
separate from transport errors.

Metadata includes allowlisted envelope names, opaque correlation IDs, semantic
context tags, and `providerGeneration`. It excludes instructions, configuration,
arguments, and audio. Supported intent content stays behind `readContent` and
requires explicit recording. Application redaction still applies to recorded data.

React realtime forwards the feed to its owning client automatically. Other
integrations use `attachRealtimeDiagnostics` from `@maelstrom-co/realtime`.
DevTools displays these observations under `voice.provider.*`.

The adapter tags UI and recovery context at the send site. It does not infer
meaning or snapshot revisions from grounding text. Native provider generation
and realtime session generation are independent counters.

## License

[MIT](./LICENSE)
