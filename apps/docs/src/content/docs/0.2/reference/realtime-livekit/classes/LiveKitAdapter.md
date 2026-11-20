---
editUrl: false
next: false
prev: false
title: "LiveKitAdapter"
---

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:193

A RealtimeProviderAdapter backed by a LiveKit cascaded STT/TTS
pipeline instead of a speech-native realtime model. It joins a LiveKit room,
publishes an upstream-gated mic, and synthesizes an `update_ui` tool call
from each final user transcript so a
cascaded pipeline drives the exact same RealtimeSession machinery
(speak-after-render, barge-in, sidechannel events) as the OpenAI realtime
adapter. The companion worker has no LLM and receives no UI grounding. The
synthesized intent still reaches the Maelstrom Engine, which remains the
planning LLM.

Browser VAD is automatic by default. Idle microphone audio remains local;
the upstream publication opens only for an accepted turn and is paused again
before that turn ends. `vad: false` selects intentional manual control
without loading VAD assets. Invalid configuration and VAD setup or callback
failures degrade a still-usable connection to manual mode only after upstream
audio is safely paused. Transport failures remain fatal and never advertise
manual fallback. Manual controls are therefore dynamic and available only
while the adapter has established manual mode.

A companion worker (`@maelstrom-co/realtime-livekit-agent`) owns the actual
STT (Deepgram) and TTS (Cartesia); this adapter only relays over the room:
transcripts in (`RoomEvent.TranscriptionReceived`), speak text out
(`SPEAK_TOPIC`). Tool calls, tool results, and speak-after-render sequencing
are all `RealtimeSession`'s concern — the same code path every provider uses.

LiveKit's WebRTC internals are exercised by live validation rather than unit
tests. Unit tests cover the adapter's mocked room orchestration, transcript →
tool-call synthesis, tool-result → speak-topic payload, and state mapping.

## Example

```ts
const adapter = new LiveKitAdapter({
  mintToken: (roomName) => fetchLiveKitToken(roomName),
  roomName: `maelstrom-${sessionId}`,
});
const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();
// Automatic mode is ready; use `vad: false` when the UI needs hold-to-talk.
```

## Implements

- `RealtimeProviderAdapter`
- `RealtimeGreetingAdapter`

## Constructors

### Constructor

> **new LiveKitAdapter**(`options`): `LiveKitAdapter`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:300

Creates a disconnected adapter. VAD configuration is validated eagerly but
retained as a diagnostic setup failure rather than thrown; `connect()` can
then establish safely paused manual mode. `activateAudio()` may prepare a
room for the initiating gesture, but no microphone, VAD runtime, worklet,
or network resource is created until `connect()`.

#### Parameters

##### options

[`LiveKitAdapterOptions`](/reference/realtime-livekit/interfaces/livekitadapteroptions/)

#### Returns

`LiveKitAdapter`

## Properties

### observations

> `readonly` **observations**: `TranscriptObservationFeed`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:212

Transcript fragments on a local receipt-time timeline. Each push-to-talk
or VAD turn becomes one final user fragment when the worker's final
transcript arrives, and the fixed greeting becomes one final assistant
fragment when the worker reports its playout start. Media evidence is not
reported.

#### Implementation of

`RealtimeProviderAdapter.observations`

## Accessors

### turnControl

#### Get Signature

> **get** **turnControl**(): `AdapterTurnControl` \| `undefined`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:345

Present only after this connection safely establishes manual turns.

##### Returns

`AdapterTurnControl` \| `undefined`

#### Implementation of

`RealtimeProviderAdapter.turnControl`

## Methods

### activateAudio()

> **activateAudio**(): `void`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:684

Prepare LiveKit playback inside the initiating gesture. RealtimeSession
calls this before `connect()`, so a new room is created and retained for
that connection. Calling `startAudio()` synchronously lets the SDK acquire
its audio context while browser user activation is still available.

#### Returns

`void`

#### Implementation of

`RealtimeGreetingAdapter.activateAudio`

***

### connect()

> **connect**(`_opts`): `Promise`\<`void`\>

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:377

Joins the LiveKit room and wires the transcript/TTS relay.

Microphone capture requests browser AEC, noise suppression, and automatic
gain control as best-effort preferences, not guaranteed device behavior.
When debug logging is enabled, the accepted original track's applied
boolean settings are projected to bounded output before it is cloned for
metering/VAD and muted before publication. Superseded acquisitions emit no
settings diagnostic. Missing, malformed, or throwing settings APIs produce
`unavailable` and never fail the connection. This deliberately avoids
`setMicrophoneEnabled(true)`,
which publishes an enabled track before the adapter can apply its upstream
gate. The connection does not expose automatic or manual turn mode until
the published track is upstream-paused. `vad: false` changes only turn
detection: capture still requests the same processing preferences and the
publication remains gated. Capture, clone, mute, publication, or pause
failures are fatal and release all acquired local tracks.

Phase-1 degeneracy: `opts.tools` and `opts.instructions` are intentionally
ignored. There is no LLM in the worker to configure — this adapter always
synthesizes a single `update_ui` tool call per transcript regardless of
the declared tool set. When a worker-side LLM lands, `tools`/`instructions`
become its session config (declared tools + system prompt), matching how
RealtimeProviderAdapter's speech-native implementations consume
them today.

#### Parameters

##### \_opts

`AdapterConnectOptions`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:537

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.disconnect`

***

### enableAudio()

> **enableAudio**(): `Promise`\<`void`\>

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:674

Concrete-only: unlock audio playback after a user gesture.

#### Returns

`Promise`\<`void`\>

***

### getAudioStreams()

> **getAudioStreams**(): `AdapterAudioStreams`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:559

Live mic and playback streams for UI metering. The mic is read from the
enabled clone of the captured microphone. LiveKit pauses the generated
publication upstream between automatic turns, but this clone stays local
and enabled for browser VAD until teardown. Playback is the worker's TTS track, captured
when it is subscribed. Both are undefined before connect and after
disconnect. Never throws.

#### Returns

`AdapterAudioStreams`

#### Implementation of

`RealtimeProviderAdapter.getAudioStreams`

***

### injectGrounding()

> **injectGrounding**(`_text`): `void`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:662

No-op in phase 1: the companion worker has no LLM and receives no UI
grounding. The Maelstrom Engine remains the planning LLM, but receives its
request-embedded planning context through the normal intent path rather
than this provider hook. The worker's STT and TTS models continue to handle
transcription and synthesis without consuming grounding. This hook becomes
active only if a worker-side LLM is added to receive it.

#### Parameters

##### \_text

`string`

#### Returns

`void`

#### Implementation of

`RealtimeProviderAdapter.injectGrounding`

***

### on()

> **on**(`handler`): `Unsubscribe`

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:666

#### Parameters

##### handler

(`event`) => `void`

#### Returns

`Unsubscribe`

#### Implementation of

`RealtimeProviderAdapter.on`

***

### sendToolResult()

> **sendToolResult**(`callId`, `output`): `Promise`\<`void`\>

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:593

Relays a tool result back to the user as speech over the `speak` text
stream, where the worker synthesizes it via Cartesia and plays it into the
room. The companion worker has no LLM and receives no UI grounding, so the
adapter picks the words itself: for an `update_ui` result it voices the
engine's `userMessage` when present, else the structural `summary`; a
read-only snapshot (get_ui_state / get_capabilities) is serialized. The
Maelstrom Engine remains the planning LLM. Speak-after-render ordering is
not this adapter's concern — RealtimeSession only calls this once
the render has settled.

Emits `speaking` on hand-off but does NOT collapse back here: the worker
publishes a `tts_done` packet on [TTS\_TOPIC](/reference/realtime-livekit/variables/tts_topic/) when playout actually
finishes, and collapseSpeaking reacts to that — so the state tracks
real audio end, not text hand-off.

Sending the spoken confirmation is best-effort because `update_ui` has already
applied and nothing downstream waits for this read-back. If no room is active,
an intentional teardown raced the result: the adapter warns once, collapses
any transient `speaking` state, and returns without emitting an adapter error.
If a room exists but `sendText` fails, the adapter emits a plain, non-fatal
`Error` (never a `RealtimeVoiceError`). If the failed handoff is still
current, the adapter discards it and collapses `speaking`. A concurrent newer
handoff stays outstanding and keeps its active state; genuine connection
loss is reported separately by the room's connection-state events.

If a prior barge-in muted the persistent remote sink, this new
assistant-turn handoff is the only normal path that unmutes it. TTS
completion/error signals do not unmute playback because they may be stale.

#### Parameters

##### callId

`ToolCallId`

##### output

`ToolResult`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.sendToolResult`

***

### speakAssistantText()

> **speakAssistantText**(`args`): `Promise`\<`GreetingSpeechResult`\>

Defined in: packages/realtime-livekit/src/livekit-adapter.ts:702

Speak the exact configured greeting text once the coordinator hands off.
Waits for the worker's `tts_ready` gate; reuses the existing SPEAK_TOPIC
hand-off. The engine `id` is never sent to the worker, because LiveKit has
no provider conversation; it only names the greeting's caption fragment.
Once `sendText()` starts, delivery is ambiguous and therefore terminal to
preserve at-most-once speech across reconnects.

#### Parameters

##### args

###### id

`MessageId`

###### onPlaybackStart?

() => `void`

###### signal

`AbortSignal`

###### text

`string`

#### Returns

`Promise`\<`GreetingSpeechResult`\>

#### Implementation of

`RealtimeGreetingAdapter.speakAssistantText`
