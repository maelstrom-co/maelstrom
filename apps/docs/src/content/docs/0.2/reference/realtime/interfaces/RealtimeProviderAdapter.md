---
editUrl: false
next: false
prev: false
title: "RealtimeProviderAdapter"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:214

A transport with the implemented Maelstrom tool and grounding integration.

## Extends

- [`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/)

## Extended by

- [`RealtimeGreetingAdapter`](/reference/realtime/interfaces/realtimegreetingadapter/)

## Properties

### diagnostics?

> `readonly` `optional` **diagnostics?**: [`AdapterDiagnosticSource`](/reference/realtime/interfaces/adapterdiagnosticsource/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:200

Optional projected provider evidence. Subscription enables diagnostics without starting transport work.

#### Inherited from

[`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/).[`diagnostics`](/reference/realtime/interfaces/realtimetransportadapter/#diagnostics)

***

### generatedOpening?

> `readonly` `optional` **generatedOpening?**: [`AdapterGeneratedOpening`](/reference/realtime/interfaces/adaptergeneratedopening/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:225

Optional natural-opening request; it does not satisfy the fixed-text greeting contract.

***

### observations

> `readonly` **observations**: [`AdapterVoiceObservations`](/reference/realtime/interfaces/adaptervoiceobservations/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:223

Continuous transcript and media evidence, separate from the legacy
exhaustive event union. Every adapter defines the feed; each event kind
within it is optional, and media an adapter never reports stays `unknown`.
Providers without media timestamps can use `TranscriptObservationFeed`.

#### Overrides

[`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/).[`observations`](/reference/realtime/interfaces/realtimetransportadapter/#observations)

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

***

### turnControl?

> `readonly` `optional` **turnControl?**: [`AdapterTurnControl`](/reference/realtime/interfaces/adapterturncontrol/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:258

Manual control for the current connection generation. It may appear,
change, or disappear as the adapter establishes or leaves manual mode;
speech-native adapters omit it.

Invariant: `RealtimeSession` never invokes this. It delegates the current
value to binding/UI code only while retained `turnMode` is `manual`.

## Methods

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

#### Overrides

[`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/).[`connect`](/reference/realtime/interfaces/realtimetransportadapter/#connect)

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:236

Releases local participation and bounds provider finalization.

#### Returns

`Promise`\<`void`\>

#### Overrides

[`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/).[`disconnect`](/reference/realtime/interfaces/realtimetransportadapter/#disconnect)

***

### getAudioStreams()

> **getAudioStreams**(): [`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:238

Streams for UI metering. Never throws; absent streams are undefined.

#### Returns

[`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

#### Overrides

[`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/).[`getAudioStreams`](/reference/realtime/interfaces/realtimetransportadapter/#getaudiostreams)

***

### getTransportSnapshot()?

> `optional` **getTransportSnapshot**(): [`AdapterTransportSnapshot`](/reference/realtime/interfaces/adaptertransportsnapshot/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:216

Optional transport facts. Native generation is independent of RealtimeSession generation.

#### Returns

[`AdapterTransportSnapshot`](/reference/realtime/interfaces/adaptertransportsnapshot/)

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

#### Overrides

[`RealtimeTransportAdapter`](/reference/realtime/interfaces/realtimetransportadapter/).[`on`](/reference/realtime/interfaces/realtimetransportadapter/#on)

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
