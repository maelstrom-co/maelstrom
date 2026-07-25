# @maelstrom-co/realtime-openai

`@maelstrom-co/realtime-openai` connects `RealtimeSession` to OpenAI
`gpt-realtime` over a client-direct WebRTC session. The browser adapter owns
the peer connection, microphone capture, data-channel envelopes, and
response-lifecycle pacing. The companion `@maelstrom-co/realtime-openai-server`
package mints the ephemeral client secret the adapter connects with; it is the
only side that touches `OPENAI_API_KEY`.

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
