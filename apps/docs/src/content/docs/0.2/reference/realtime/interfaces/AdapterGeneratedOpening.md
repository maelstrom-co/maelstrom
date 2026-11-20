---
editUrl: false
next: false
prev: false
title: "AdapterGeneratedOpening"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:340

Natural-opening capability for providers that generate their own wording.

## Properties

### readiness?

> `readonly` `optional` **readiness?**: `object`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:342

Optional output readiness gate. Omission permits an immediate opening claim.

#### getSnapshot()

> **getSnapshot**(): `boolean`

Whether playback has been accepted for the current connection, not proof of audibility.

##### Returns

`boolean`

#### subscribe()

> **subscribe**(`handler`): `Unsubscribe`

Observes readiness changes. The returned disposer releases the subscription.

##### Parameters

###### handler

() => `void`

##### Returns

`Unsubscribe`

## Methods

### request()

> **request**(`instructions`): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:353

Requests a natural opening. Resolution proves only request acceptance, not
speech delivery. Publish actual words only through observed transcripts.
Rejection may follow a send, so callers must not automatically retry.

#### Parameters

##### instructions

`string`

#### Returns

`Promise`\<`void`\>
