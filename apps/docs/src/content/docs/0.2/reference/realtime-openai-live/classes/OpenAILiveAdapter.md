---
editUrl: false
next: false
prev: false
title: "OpenAILiveAdapter"
---

Defined in: packages/realtime-openai-live/src/live-adapter.ts:153

Connects managed Live Responses to RealtimeSession's existing UI tools.
Completed function items are collected before the terminal batch is dispatched.
Every result is submitted before one explicit continuation. Local submission
does not prove provider acceptance or speech. Closing voice never cancels
submitted application work; late results cannot enter a new connection.
Deduplication lasts for the connection, with hard capacity bounds instead of
eviction that could repeat effects. Generated opening is opt-in; reconnect is explicit.

## Implements

- `RealtimeProviderAdapter`

## Constructors

### Constructor

> **new OpenAILiveAdapter**(`options`): `OpenAILiveAdapter`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:186

Creates an inert adapter. Invalid bounds throw before any media acquisition.

#### Parameters

##### options

[`OpenAILiveAdapterOptions`](/reference/realtime-openai-live/interfaces/openailiveadapteroptions/)

#### Returns

`OpenAILiveAdapter`

## Properties

### diagnostics

> `readonly` **diagnostics**: `AdapterDiagnosticSource`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:177

Projected native diagnostics, separate from provider commands and continuous voice observations.

#### Implementation of

`RealtimeProviderAdapter.diagnostics`

***

### generatedOpening

> `readonly` **generatedOpening**: `object`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:157

Native instruction append; acceptance is not speech completion. The complete instruction, including its fixed prefix, must fit 500 UTF-8 bytes. Rejection consumes the attempt.

#### readiness

> **readiness**: `object`

Playback acceptance gates the introduction claim without delaying microphone or transport startup.

##### readiness.getSnapshot

> **getSnapshot**: () => `boolean`

Reports playback acceptance for the current transport generation, not audibility.

###### Returns

`boolean`

##### readiness.subscribe

> **subscribe**: (`handler`) => () => `void`

Observes output-readiness changes until the returned disposer is called.

###### Parameters

###### handler

() => `void`

###### Returns

() => `void`

#### request

> **request**: (`instructions`) => `Promise`\<`void`\>

##### Parameters

###### instructions

`string`

##### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.generatedOpening`

***

### observations

> `readonly` **observations**: `AdapterVoiceObservations`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:155

Continuous media and captions from the transport, without fabricated final turns.

#### Implementation of

`RealtimeProviderAdapter.observations`

***

### recovery

> `readonly` **recovery**: `object`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:171

Quiet updates for outcomes from earlier connections. Current calls use function results; retained functions are never replayed.

#### update

> **update**: (`snapshot`) => `void`

##### Parameters

###### snapshot

`VoiceRecoverySnapshot`

##### Returns

`void`

#### Implementation of

`RealtimeProviderAdapter.recovery`

## Methods

### activateAudio()

> **activateAudio**(): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-adapter.ts:447

Retries blocked playback within a user action; resolution is not audibility evidence.

#### Returns

`Promise`\<`void`\>

***

### connect()

> **connect**(`options`): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-adapter.ts:234

Starts managed delegation. Conversation instructions and backend tool instructions use separate configuration fields.

#### Parameters

##### options

`AdapterConnectOptions`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-adapter.ts:438

Stops voice immediately and bounds provider finalization without awaiting application work.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.disconnect`

***

### getAudioStreams()

> **getAudioStreams**(): `AdapterAudioStreams`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:443

Returns the transport's current streams for metering.

#### Returns

`AdapterAudioStreams`

#### Implementation of

`RealtimeProviderAdapter.getAudioStreams`

***

### getTransportSnapshot()

> **getTransportSnapshot**(): [`LiveTransportSnapshot`](/reference/realtime-openai-live/interfaces/livetransportsnapshot/)

Defined in: packages/realtime-openai-live/src/live-adapter.ts:451

Returns detached transport evidence, including final usage and playback acceptance.

#### Returns

[`LiveTransportSnapshot`](/reference/realtime-openai-live/interfaces/livetransportsnapshot/)

#### Implementation of

`RealtimeProviderAdapter.getTransportSnapshot`

***

### injectGrounding()

> **injectGrounding**(`text`): `void`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:491

Appends at most 400 UTF-8 bytes of observed structural context as quiet data.
One pending acknowledgment and one latest update bound context state.
Acknowledgment and timeout never imply spoken delivery; unchanged context is skipped.

#### Parameters

##### text

`string`

#### Returns

`void`

#### Implementation of

`RealtimeProviderAdapter.injectGrounding`

***

### on()

> **on**(`handler`): () => `void`

Defined in: packages/realtime-openai-live/src/live-adapter.ts:455

Subscribes to tool calls and lifecycle events. Observer exceptions cannot interrupt another observer.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

() => `void`

#### Implementation of

`RealtimeProviderAdapter.on`

***

### sendToolResult()

> **sendToolResult**(`callId`, `output`): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-adapter.ts:471

Records a settled application result. Resolution means local handling only.
Duplicate results keep the first value. Results after close are discarded
from provider delivery while the owning RealtimeSession retains its outcome.
The complete result must support JSON serialization and fit within 262,144
UTF-16 code units after serialization. Invalid or oversized results terminate
voice and emit DATA_CHANNEL_ERROR while this promise resolves. Observe error
events rather than relying on promise rejection. Submitted application work
is not undone.

#### Parameters

##### callId

`ToolCallId`

##### output

`ToolResult`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeProviderAdapter.sendToolResult`
