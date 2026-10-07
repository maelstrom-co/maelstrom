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

## License

[MIT](./LICENSE)
