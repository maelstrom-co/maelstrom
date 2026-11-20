---
editUrl: false
next: false
prev: false
title: "OpenAILiveTransport"
---

Defined in: packages/realtime-openai-live/src/live-transport.ts:142

Explicit WebRTC transport with L1 continuous observations. Managed function
execution and Maelstrom grounding belong to a separate integration. Finish
required Responses function outputs before calling disconnect: session.close
rejects later commands. This transport never reconnects or replays commands.

## Implements

- `RealtimeTransportAdapter`\<`LiveSessionConfig`\>

## Constructors

### Constructor

> **new OpenAILiveTransport**(`options`): `OpenAILiveTransport`

Defined in: packages/realtime-openai-live/src/live-transport.ts:179

Creates an inert transport. No media or billed session starts until connect.

#### Parameters

##### options

[`LiveTransportOptions`](/reference/realtime-openai-live/interfaces/livetransportoptions/)

#### Returns

`OpenAILiveTransport`

## Properties

### diagnostics

> `readonly` **diagnostics**: `AdapterDiagnosticSource`

Defined in: packages/realtime-openai-live/src/live-transport.ts:147

Optional projected native evidence; subscribing never starts media or transport work.

#### Implementation of

`RealtimeTransportAdapter.diagnostics`

***

### observations

> `readonly` **observations**: `AdapterVoiceObservations`

Defined in: packages/realtime-openai-live/src/live-transport.ts:169

Optional continuous evidence channel; transcript fragments never imply final turns.

#### Implementation of

`RealtimeTransportAdapter.observations`

## Methods

### activateAudio()

> **activateAudio**(): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-transport.ts:268

Retries output playback within a user action. Resolution means play acceptance, not audible delivery.

#### Returns

`Promise`\<`void`\>

***

### connect()

> **connect**(`session`): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-transport.ts:228

Starts microphone acquisition within the caller's user activation; concurrent starts share one attempt.

#### Parameters

##### session

`LiveSessionConfig`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeTransportAdapter.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime-openai-live/src/live-transport.ts:311

Stops participation promptly, then drains session.closed for a bounded interval. Never waits for host tool work.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`RealtimeTransportAdapter.disconnect`

***

### getAudioStreams()

> **getAudioStreams**(): `AdapterAudioStreams`

Defined in: packages/realtime-openai-live/src/live-transport.ts:222

Returns current streams for metering; local participation disappears immediately on stop.

#### Returns

`AdapterAudioStreams`

#### Implementation of

`RealtimeTransportAdapter.getAudioStreams`

***

### getSnapshot()

> **getSnapshot**(): [`LiveTransportSnapshot`](/reference/realtime-openai-live/interfaces/livetransportsnapshot/)

Defined in: packages/realtime-openai-live/src/live-transport.ts:195

Returns detached lifecycle and final provider evidence; native fields cannot mutate transport state.

#### Returns

[`LiveTransportSnapshot`](/reference/realtime-openai-live/interfaces/livetransportsnapshot/)

***

### on()

> **on**(`handler`): () => `void`

Defined in: packages/realtime-openai-live/src/live-transport.ts:206

Subscribes to legacy lifecycle events without fabricating turn activity.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

() => `void`

#### Implementation of

`RealtimeTransportAdapter.on`

***

### onServerEvent()

> **onServerEvent**(`handler`): () => `void`

Defined in: packages/realtime-openai-live/src/live-transport.ts:213

Subscribes to validated native envelopes. Nested Responses payloads require consumer validation.

#### Parameters

##### handler

(`event`, `generation`) => `void`

#### Returns

() => `void`

***

### send()

> **send**(`command`, `generation`, `contextKind?`): `void`

Defined in: packages/realtime-openai-live/src/live-transport.ts:278

Submits one command only to the supplied generation. There is no queue, retry, or success acknowledgment.

#### Parameters

##### command

`LiveCommand`

##### generation

`number`

##### contextKind?

[`LiveContextKind`](/reference/realtime-openai-live/type-aliases/livecontextkind/)

#### Returns

`void`

***

### subscribe()

> **subscribe**(`handler`): () => `void`

Defined in: packages/realtime-openai-live/src/live-transport.ts:199

Observes metadata changes, including autoplay recovery and finalization.

#### Parameters

##### handler

() => `void`

#### Returns

() => `void`
