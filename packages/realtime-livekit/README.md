# @maelstrom-co/realtime-livekit

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
- **Speak out:** `sendToolResult` extracts the summary and sends it over the
  `speak` text stream; the worker synthesizes it via Cartesia.
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

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

const adapter = new LiveKitAdapter({
  mintToken: (roomName) => fetchLiveKitToken(roomName),
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
