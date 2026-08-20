# @maelstrom-co/realtime-openai

[![npm](https://img.shields.io/npm/v/@maelstrom-co/realtime-openai.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/realtime-openai)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

`@maelstrom-co/realtime-openai` connects `RealtimeSession` to OpenAI
`gpt-realtime` over a client-direct WebRTC session. The browser adapter owns
the peer connection, microphone capture, data-channel envelopes, and
response-lifecycle pacing. The companion `@maelstrom-co/realtime-openai-server`
package mints the ephemeral client secret the adapter connects with; it is the
only side that touches `OPENAI_API_KEY`.

📚 **Full documentation:** <https://docs.maelstrom-ai.co>

The package is separate from `@maelstrom-co/realtime` so applications that do
not use OpenAI's speech-native transport do not pull in this adapter's wire
parsing and lifecycle bookkeeping — the core stays provider-neutral, and every
realtime voice provider (OpenAI, LiveKit, …) ships as its own sibling package.

## How the adapter drives Maelstrom

`OpenAIAdapter` mints an ephemeral client secret via the injected `mintToken`,
exchanges SDP with `POST /v1/realtime/calls`, and drives tool calls and
grounding pushes over the `oai-events` data channel. The model's only write
path is `update_ui { intent: string }`; the same `RealtimeSession` machinery
handles speak-after-render, barge-in, and sidechannel events regardless of
provider.

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import { OpenAIAdapter } from '@maelstrom-co/realtime-openai';

const adapter = new OpenAIAdapter({
  mintToken: () =>
    fetch('/api/realtime/mint', { method: 'POST' }).then((r) => r.json()),
});

const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();
```

## Transcription

Input-audio transcription is enabled by default with a built-in model. Pass
`transcription: { model }` to override it, or `transcription: false` to
disable transcription entirely:

```ts
new OpenAIAdapter({
  mintToken: () => mintOpenAIToken(sessionId),
  transcription: { model: 'whisper-1' },
});
```

## Server VAD and interruption

Tune OpenAI's server VAD and interruption policy through `serverVad`:

```ts
new OpenAIAdapter({
  mintToken: () => mintOpenAIToken(sessionId),
  serverVad: {
    threshold: 0.65,
    bargeInMode: 'transcript-confirmed',
  },
});
```

`threshold` defaults to `0.5`, and `bargeInMode` defaults to `immediate`.
`transcript-confirmed` requires input transcription; combining it with
`transcription: false` throws synchronously before connection work begins. See
the [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/#configure-server-vad)
for interruption mechanics, audio-processing limitations, and tuning guidance.

## Experimental greeting interruption

`greetingInterruption?: false | true | BrowserVadOptions` is experimental and
default-off. Omitted and `false` keep the current raw-track gate and do not
load VAD or worklet runtime. `true` selects shared defaults; an object is
validated synchronously by the constructor. Enabled connections lazy-load
`@maelstrom-co/realtime-vad` only during connection preparation.

Local acceptance is playback-scoped. The first accepted local boundary stops
greeting playback, then flushes one bounded 0–500 ms pre-roll. Normal
completion and Skip discard the retained tail. After greeting settlement,
OpenAI server VAD is unchanged. Skip greeting remains the reliable control.
`BrowserVadOptions` is available from `@maelstrom-co/realtime-openai`.

See [Configure experimental greeting interruption](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/#configure-experimental-greeting-interruption).

## Connection lifecycle

`connect()` is guarded against re-entrancy while a mint round-trip is in
flight, and a superseded attempt tears down only its own peer connection and
microphone stream — never the winner's. An ICE `disconnected` state opens a
5-second grace window before it is treated as fatal (ICE often self-recovers);
`failed` is fatal immediately. A fatal error tears the adapter down completely
so a subsequent `connect()` starts clean instead of throwing
`ALREADY_CONNECTED`.

## Entry points

- `@maelstrom-co/realtime-openai` — browser `OpenAIAdapter` and configuration
  types. It also re-exports everything below, so a browser application needs
  this entry point alone.

The token grant type lives in the contract leaf, which the minter imports
without pulling in this browser package:

- `@maelstrom-co/realtime-protocol/openai` — the OpenAI token grant type and
  its zod schema, shared with `@maelstrom-co/realtime-openai-server`.

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/

## License

MIT
