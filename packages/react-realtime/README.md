# @maelstrom-co/react-realtime

[![npm](https://img.shields.io/npm/v/@maelstrom-co/react-realtime.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/react-realtime)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Provider-neutral React binding for Maelstrom voice sessions.

**Full documentation:** <https://docs.maelstrom-ai.co>

## Install

```bash
bun add @maelstrom-co/react-realtime @maelstrom-co/react @maelstrom-co/realtime
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/react-realtime @maelstrom-co/react @maelstrom-co/realtime`

## What it does

Add `maelstromRealtime({ createAdapter })` with `.with()` when you create your Maelstrom instance. The extension adds a shared `m.useVoice()` hook and an `m.VoiceOrb` component. The hook exposes lifecycle state, typed session failures through `error`, user and assistant transcripts, `connect()`, `disconnect()`, and optional `turnControl` for providers that require explicit turn boundaries.

Choose and configure the concrete provider adapter in application code. The binding does not impose one provider's state progression or recovery policy on another.

### Session contract

The hook reports what the session is doing; it does not promise a fixed sequence of events.

- A successful `connect()` means the provider session is ready.
- A rejected `connect()`, or an `error` state, means the attempt failed.
- `disconnect()` ends the shared session.
- Repeated `connect()` or `disconnect()` calls while a connection is already starting or live may be no-ops.

Render the current `state` rather than inferring success from a fixed order. There is no universal state sequence across providers and no universal retry policy. Use the typed error code and your own deployment policy to decide whether to request microphone permission, repair token minting, inspect the connection, or offer a reconnect.

`turnControl` is a capability, not a constant. Speech-native adapters leave it undefined because the provider owns turn detection. Adapters that require explicit turn boundaries expose it, and application code should render hold-to-talk only while it is present.

The React binding does not create a VAD controller. `LiveKitAdapter` drives the
provider-neutral engine from `@maelstrom-co/realtime-vad`; applications deploy
that package's matching browser assets during their build. Add
`@maelstrom-co/realtime-vad` as a direct dependency so package managers link its
`maelstrom-vad-assets` CLI onto the application's `PATH`.

## Docs

- [Voice guide](https://docs.maelstrom-ai.co/guides/voice/overview/)
- [React voice API reference](https://docs.maelstrom-ai.co/reference/react-realtime/readme/)
- [Voice architecture](https://docs.maelstrom-ai.co/understanding/voice-architecture/)

## License

MIT
