# @maelstrom-co/react-realtime

Provider-neutral React binding for Maelstrom voice sessions.

Add `maelstromRealtime({ createAdapter })` with `.with()` when you create your Maelstrom instance. The extension adds a shared `m.useVoice()` hook and an `m.VoiceOrb` component. The hook exposes lifecycle state, typed session failures through `error`, user and assistant transcripts, `connect()`, `disconnect()`, and optional `turnControl` for providers that require explicit turn boundaries.

Choose and configure the concrete provider adapter in application code. The binding does not impose one provider's state progression or recovery policy on another.

## Documentation

- [Voice guide](https://docs.maelstrom-ai.co/guides/voice/overview/)
- [React voice API reference](https://docs.maelstrom-ai.co/reference/react-realtime/readme/)
- [Voice architecture](https://docs.maelstrom-ai.co/understanding/architecture/)

## License

MIT
