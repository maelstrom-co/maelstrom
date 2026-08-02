# `@maelstrom-co/realtime-livekit`

Browser adapter for Maelstrom’s LiveKit cascade voice transport.

The package implements `RealtimeProviderAdapter` from `@maelstrom-co/realtime` using:

* LiveKit for browser-to-worker audio transport
* Deepgram for worker-side speech-to-text
* Cartesia for worker-side text-to-speech
* Maelstrom’s existing Engine path for intent planning

The LiveKit worker contains no conversational or planning LLM. Every final transcript becomes ordinary natural-language intent and passes through the same `RealtimeSession`, Maelstrom client, and Engine path used by other voice transports.

The package is separate from `@maelstrom-co/realtime` so applications that do not use LiveKit do not receive `livekit-client` in their browser bundle.

## Architecture

```text
Browser                              LiveKit worker
┌─────────────────────────────┐      ┌──────────────────────────┐
│ LiveKitAdapter              │      │ Deepgram STT             │
│                             │      │                          │
│ microphone ─────────────────┼─────►│ final transcript         │
│                             │◄─────┼──────────────────────────│
│ final transcript            │      │                          │
│        │                    │      │ Cartesia TTS             │
│        ▼                    │      │                          │
│ RealtimeSession             │─────►│ settled response text    │
│        │                    │◄─────┼ synthesized audio        │
│        ▼                    │      └──────────────────────────┘
│ Maelstrom client + Engine   │
└─────────────────────────────┘
```

A `RealtimeProviderAdapter` (from `@maelstrom-co/realtime`) backed by a LiveKit
cascaded STT/TTS voice pipeline instead of a speech-native realtime model.

Shipped separately from `@maelstrom-co/realtime` so consumers of the core never
have `livekit-client` forced on them — pull this in only when you want the
LiveKit transport.

## The idea

`LiveKitAdapter` **synthesizes an `update_ui` tool call from each final user
transcript**, so a cascaded pipeline drives the exact same `RealtimeSession`
machinery (speak-after-render, barge-in, sidechannel events) as the OpenAI
realtime adapter — with no voice-side LLM in the worker or adapter. The
synthesized intent still flows through Maelstrom's engine LLM via
`RealtimeSession`, exactly as an OpenAI-realtime session would.

- **Transcripts in:** `RoomEvent.TranscriptionReceived` → `transcript` event +
  a synthesized `update_ui` `tool_call`.
- **Speak out:** `sendToolResult` selects `userMessage ?? summary` and sends it
  over the `speak` text stream; the worker synthesizes it via Cartesia.
- **Hold-to-talk:** `adapter.turnControl.startTurn()` /
  `adapter.turnControl.endTurn()` unmute and mute the published microphone;
  ending the turn also asks the worker to flush its STT buffer.

The companion worker (`@maelstrom-co/realtime-livekit-agent`) owns the actual
STT (Deepgram) and TTS (Cartesia). No LLM in the worker in phase 1.

## Entry points

- **`@maelstrom-co/realtime-livekit`** — `LiveKitAdapter` (browser).
- **`@maelstrom-co/realtime-livekit-server`** — `mintLiveKitToken` (Node only).
- **`@maelstrom-co/realtime-livekit/protocol`** — wire topic constants shared
  with the worker.

## Usage

```bash
npm install @maelstrom-co/realtime-livekit livekit-client
pnpm add @maelstrom-co/realtime-livekit livekit-client
yarn add @maelstrom-co/realtime-livekit livekit-client
```

```ts
import {
  LiveKitAdapter,
  LiveKitTokenGrantSchema,
} from '@maelstrom-co/realtime-livekit';

const adapter = new LiveKitAdapter({
  mintToken: async (roomName) => {
    const response = await fetch('/api/voice/livekit-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The route treats roomName only as a hint and derives or authorizes
      // the trusted room and identity scope from the application session.
      body: JSON.stringify({ roomName }),
    });
    if (!response.ok) throw new Error('Unable to start voice session');

    // Validate the required { token, url, expiresAt } short-lived grant.
    return LiveKitTokenGrantSchema.parse(await response.json());
  },
  roomName: `maelstrom-${sessionId}`,
});
const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();

// Hold-to-talk (the UI retains the concrete adapter capability):
await adapter.turnControl.startTurn();
await adapter.turnControl.endTurn();
```

`connect()` acquires and publishes the microphone, then mutes that publication
until `startTurn()`. Each non-empty final transcript becomes one `update_ui`
intent. An empty turn returns from `thinking` to `connected` after the bounded
`thinkingFallbackMs` interval (10 seconds by default).

See the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
for the compile-checked browser integration and exact local demo commands. The
[Voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/) compares
the provider tracks. Production token and worker setup is the guide's next
checkpoint; the checked-in demo route is development-only.

API details are available in the
[generated reference](https://docs.maelstrom-ai.co/reference/). For design
context, read the
[voice architecture reference](https://github.com/maelstrom-co/maelstrom/blob/main/docs/realtime-voice-architecture.md).
