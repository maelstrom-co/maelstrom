---
editUrl: false
next: false
prev: false
title: "RealtimeTransportAdapter"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:198

Provider-neutral transport lifecycle and observations, independently usable
before a provider has a Maelstrom tool integration. Options belong to the
implemented transport. RealtimeSession requires RealtimeProviderAdapter.

## Extended by

- [`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/)

## Type Parameters

### Options

`Options` = [`AdapterConnectOptions`](/reference/realtime/interfaces/adapterconnectoptions/)

## Properties

### diagnostics?

> `readonly` `optional` **diagnostics?**: [`AdapterDiagnosticSource`](/reference/realtime/interfaces/adapterdiagnosticsource/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:200

Optional projected provider evidence. Subscription enables diagnostics without starting transport work.

***

### observations?

> `readonly` `optional` **observations?**: [`AdapterVoiceObservations`](/reference/realtime/interfaces/adaptervoiceobservations/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:202

Optional continuous media and transcript evidence.

## Methods

### connect()

> **connect**(`opts`): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:204

Starts one explicit connection attempt from a user action.

#### Parameters

##### opts

`Options`

#### Returns

`Promise`\<`void`\>

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:206

Releases local participation and bounds provider finalization.

#### Returns

`Promise`\<`void`\>

***

### getAudioStreams()

> **getAudioStreams**(): [`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:208

Current media streams for metering.

#### Returns

[`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

***

### on()

> **on**(`handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:210

Subscribes to lifecycle events.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

`Unsubscribe`
