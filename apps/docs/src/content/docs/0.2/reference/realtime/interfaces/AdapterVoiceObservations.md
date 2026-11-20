---
editUrl: false
next: false
prev: false
title: "AdapterVoiceObservations"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:334

Adapter evidence channel, subscribed before connection setup and released on teardown.

## Methods

### subscribe()

> **subscribe**(`handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:336

Observes current-generation provider evidence; adapters must fence stale transport callbacks.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

`Unsubscribe`
