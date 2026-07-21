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
- **Hold-to-talk:** concrete `startTalking()` / `stopTalking()` unmute/mute the
  mic and flush the worker's STT buffer on `turn_end`.

The companion worker (`@maelstrom-co/realtime-livekit-agent`) owns the actual
STT (Deepgram) and TTS (Cartesia). No LLM in the worker in phase 1.

## Entry points

- **`@maelstrom-co/realtime-livekit`** — `LiveKitAdapter` (browser).
- **`@maelstrom-co/realtime-livekit/server`** — `mintLiveKitToken` (Node only).
- **`@maelstrom-co/realtime-livekit/protocol`** — wire topic constants shared
  with the worker.

## Usage

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

const adapter = new LiveKitAdapter({
  getToken: (roomName) => fetchLiveKitToken(roomName),
  roomName: `maelstrom-${sessionId}`,
});
const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();

// Hold-to-talk (demo holds the concrete adapter):
await adapter.startTalking();
await adapter.stopTalking();
```
