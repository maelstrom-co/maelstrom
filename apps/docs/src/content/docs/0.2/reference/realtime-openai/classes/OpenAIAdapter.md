---
editUrl: false
next: false
prev: false
title: "OpenAIAdapter"
---

Defined in: packages/realtime-openai/src/openai-adapter.ts:186

A RealtimeProviderAdapter that connects the browser directly to
OpenAI `gpt-realtime` over WebRTC: mints an ephemeral client secret via the
injected `mintToken`, exchanges SDP with `POST /v1/realtime/calls`, and
drives tool calls / grounding pushes over the `oai-events` data channel.

The data-channel envelope → adapter-event mapping lives in
parseOpenAIServerEvent; this class owns the provider-specific WebRTC,
response lifecycle, and transcript-confirmed interruption bookkeeping around
that mapping. The browser's WebRTC implementation itself is not unit-tested.

## Example

```ts
const adapter = new OpenAIAdapter({
  mintToken: () => fetch('/api/realtime/mint', { method: 'POST', ... }).then(r => r.json()),
});
const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();
```

## Implements

- `RealtimeProviderAdapter`
- `RealtimeGreetingAdapter`

## Constructors

### Constructor

> **new OpenAIAdapter**(`options`): `OpenAIAdapter`

Defined in: packages/realtime-openai/src/openai-adapter.ts:234

#### Parameters

##### options

[`OpenAIAdapterOptions`](/reference/realtime-openai/interfaces/openaiadapteroptions/)

#### Returns

`OpenAIAdapter`

## Properties

### observations

> `readonly` **observations**: `TranscriptObservationFeed`

Defined in: packages/realtime-openai/src/openai-adapter.ts:211

Transcript fragments on a local receipt-time timeline, one per provider
conversation item. The item's final event revises its fragment with the
full text. The fixed greeting appears as one final assistant fragment when
its playback starts. Media evidence is not reported.

#### Implementation of

`RealtimeProviderAdapter.observations`

## Methods

### activateAudio()

> **activateAudio**(): `void`

Defined in: packages/realtime-openai/src/openai-adapter.ts:559

Unlocks retained Web Audio activation in the initiating gesture.

#### Returns

`void`

#### Implementation of

`RealtimeGreetingAdapter.activateAudio`

***

### connect()

> **connect**(`opts`): `Promise`\<`void`\>

Defined in: packages/realtime-openai/src/openai-adapter.ts:311

Mints a token, captures the microphone, and opens the browser-to-OpenAI
WebRTC session. Capture requests AEC, noise suppression, and automatic gain
control as best-effort browser preferences; it does not promise that a
browser, device, or audio route applies them. After acquisition is confirmed
as current, enabled debug logging projects only applied booleans (or
`unavailable`) from the original track before attachment. Superseded
acquisitions are stopped without attachment or diagnostics, and missing or
throwing settings APIs do not fail connection.

Duplicate connections are rejected. Token, microphone, and SDP failures
reject after this attempt's resources are released. Unlike LiveKit, OpenAI
owns turn detection and has no local VAD clone or publication gate.

#### Parameters

##### opts

`AdapterConnectOptions`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime-openai/src/openai-adapter.ts:479

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.disconnect`

***

### getAudioStreams()

> **getAudioStreams**(): `AdapterAudioStreams`

Defined in: packages/realtime-openai/src/openai-adapter.ts:483

Streams for UI metering. Never throws; absent streams are undefined.

#### Returns

`AdapterAudioStreams`

#### Implementation of

`RealtimeProviderAdapter.getAudioStreams`

***

### injectGrounding()

> **injectGrounding**(`text`): `void`

Defined in: packages/realtime-openai/src/openai-adapter.ts:515

Pushes a terse grounding string into the model's context. The adapter
owns whatever latest-wins mechanics apply at the wire/session level
(e.g. overwriting session instructions rather than queuing utterances);
`RealtimeSession` additionally debounces calls into this method so the
adapter is never asked to collapse a rapid burst on its own.

#### Parameters

##### text

`string`

#### Returns

`void`

#### Implementation of

`RealtimeProviderAdapter.injectGrounding`

***

### on()

> **on**(`handler`): `Unsubscribe`

Defined in: packages/realtime-openai/src/openai-adapter.ts:551

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

Defined in: packages/realtime-openai/src/openai-adapter.ts:487

Sends a tool call's result back to the model.

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

Defined in: packages/realtime-openai/src/openai-adapter.ts:564

Delegates provider handoff and local presentation to its package-private owner.

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
