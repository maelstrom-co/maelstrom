---
editUrl: false
next: false
prev: false
title: "RealtimeGreetingAdapter"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:363

Optional greeting-only capability. A provider opts in by also implementing
this; base [RealtimeProviderAdapter](/reference/realtime/interfaces/realtimeprovideradapter/) gets no greeting methods.

## Extends

- [`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/)

## Properties

### diagnostics?

> `readonly` `optional` **diagnostics?**: [`AdapterDiagnosticSource`](/reference/realtime/interfaces/adapterdiagnosticsource/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:200

Optional projected provider evidence. Subscription enables diagnostics without starting transport work.

#### Inherited from

[`RealtimeGreetingAdapter`](/reference/realtime/interfaces/realtimegreetingadapter/).[`diagnostics`](/reference/realtime/interfaces/realtimegreetingadapter/#diagnostics)

***

### generatedOpening?

> `readonly` `optional` **generatedOpening?**: [`AdapterGeneratedOpening`](/reference/realtime/interfaces/adaptergeneratedopening/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:225

Optional natural-opening request; it does not satisfy the fixed-text greeting contract.

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`generatedOpening`](/reference/realtime/interfaces/realtimeprovideradapter/#generatedopening)

***

### observations

> `readonly` **observations**: [`AdapterVoiceObservations`](/reference/realtime/interfaces/adaptervoiceobservations/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:223

Continuous transcript and media evidence, separate from the legacy
exhaustive event union. Every adapter defines the feed; each event kind
within it is optional, and media an adapter never reports stays `unknown`.
Providers without media timestamps can use `TranscriptObservationFeed`.

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`observations`](/reference/realtime/interfaces/realtimeprovideradapter/#observations)

***

### recovery?

> `readonly` `optional` **recovery?**: `object`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:227

Optional quiet recovery update for application outcomes that settle after reconnect. Never replays tools.

#### update

> `readonly` **update**: (`snapshot`) => `void`

##### Parameters

###### snapshot

[`VoiceRecoverySnapshot`](/reference/realtime/interfaces/voicerecoverysnapshot/)

##### Returns

`void`

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`recovery`](/reference/realtime/interfaces/realtimeprovideradapter/#recovery)

***

### turnControl?

> `readonly` `optional` **turnControl?**: [`AdapterTurnControl`](/reference/realtime/interfaces/adapterturncontrol/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:258

Manual control for the current connection generation. It may appear,
change, or disappear as the adapter establishes or leaves manual mode;
speech-native adapters omit it.

Invariant: `RealtimeSession` never invokes this. It delegates the current
value to binding/UI code only while retained `turnMode` is `manual`.

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`turnControl`](/reference/realtime/interfaces/realtimeprovideradapter/#turncontrol)

## Methods

### activateAudio()

> **activateAudio**(): `void`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:370

Unlock audio synchronously within a user gesture (the click that calls
`RealtimeSession.connect()`). Must never throw. Failures are not reported
from this call — they surface later via speech `not_started` (or adapter
events). Called at most once per real connection attempt.

#### Returns

`void`

***

### connect()

> **connect**(`opts`): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:235

Opens the provider connection. The adapter mints its own ephemeral
credential internally on connect — `RealtimeSession` never passes one
in.

#### Parameters

##### opts

[`AdapterConnectOptions`](/reference/realtime/interfaces/adapterconnectoptions/)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`connect`](/reference/realtime/interfaces/realtimeprovideradapter/#connect)

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:236

Releases local participation and bounds provider finalization.

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`disconnect`](/reference/realtime/interfaces/realtimeprovideradapter/#disconnect)

***

### getAudioStreams()

> **getAudioStreams**(): [`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:238

Streams for UI metering. Never throws; absent streams are undefined.

#### Returns

[`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`getAudioStreams`](/reference/realtime/interfaces/realtimeprovideradapter/#getaudiostreams)

***

### getTransportSnapshot()?

> `optional` **getTransportSnapshot**(): [`AdapterTransportSnapshot`](/reference/realtime/interfaces/adaptertransportsnapshot/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:216

Optional transport facts. Native generation is independent of RealtimeSession generation.

#### Returns

[`AdapterTransportSnapshot`](/reference/realtime/interfaces/adaptertransportsnapshot/)

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`getTransportSnapshot`](/reference/realtime/interfaces/realtimeprovideradapter/#gettransportsnapshot)

***

### injectGrounding()

> **injectGrounding**(`text`): `void`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:248

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

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`injectGrounding`](/reference/realtime/interfaces/realtimeprovideradapter/#injectgrounding)

***

### on()

> **on**(`handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:249

Subscribes to lifecycle events.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

`Unsubscribe`

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`on`](/reference/realtime/interfaces/realtimeprovideradapter/#on)

***

### sendToolResult()

> **sendToolResult**(`callId`, `output`): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:240

Sends a tool call's result back to the model.

#### Parameters

##### callId

`ToolCallId`

##### output

[`ToolResult`](/reference/realtime/type-aliases/toolresult/)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/).[`sendToolResult`](/reference/realtime/interfaces/realtimeprovideradapter/#sendtoolresult)

***

### speakAssistantText()

> **speakAssistantText**(`args`): `Promise`\<[`GreetingSpeechResult`](/reference/realtime/type-aliases/greetingspeechresult/)\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:380

Speak the exact configured text once. Call `onPlaybackStart` at the
provider's closest reliable playout-start boundary. Local players can use
the exact source start; remote transports may only prove that their first
frame entered the playout queue. Providers that never start must not call it.
`not_started` proves no provider
send or playback began — the only retriable outcome. `accepted` is
terminal: delivery is ambiguous past invocation and is never retried.

#### Parameters

##### args

###### id

`MessageId`

###### onPlaybackStart?

() => `void`

Called at most once at the provider's documented playout-start boundary.

###### signal

`AbortSignal`

###### text

`string`

#### Returns

`Promise`\<[`GreetingSpeechResult`](/reference/realtime/type-aliases/greetingspeechresult/)\>
