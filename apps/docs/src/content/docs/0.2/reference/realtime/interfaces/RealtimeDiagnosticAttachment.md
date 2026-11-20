---
editUrl: false
next: false
prev: false
title: "RealtimeDiagnosticAttachment"
---

Defined in: packages/realtime/src/lib/diagnostics.ts:21

Inputs shared by every framework's realtime diagnostic attachment.

## Properties

### adapter

> `readonly` **adapter**: [`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/)

Defined in: packages/realtime/src/lib/diagnostics.ts:25

Existing adapter supplying optional provider diagnostics and transport facts.

***

### identity

> `readonly` **identity**: `object`

Defined in: packages/realtime/src/lib/diagnostics.ts:42

Immutable identity for this provider lifetime.

#### provider

> `readonly` **provider**: `string`

Application-owned provider label.

#### providerInstanceId

> `readonly` **providerInstanceId**: `string`

Unique identity of this built session, independent of application session identity.

***

### session

> `readonly` **session**: [`RealtimeSession`](/reference/realtime/classes/realtimesession/)

Defined in: packages/realtime/src/lib/diagnostics.ts:23

Existing session; attachment never connects it or acquires media.

***

### sink

> `readonly` **sink**: `Pick`\<`DiagnosticChannel`, `"observed"` \| `"addSource"`\> & `object` & `Partial`\<`Pick`\<`DiagnosticChannel`, `"diagnosticsObserved"` \| `"addDiagnosticSource"` \| `"emitDiagnostic"`\>\>

Defined in: packages/realtime/src/lib/diagnostics.ts:27

Owning client observation seam; no DevTools or framework dependency is needed.

#### Type Declaration

##### emit()

> **emit**(`kind`, `metadata?`, `readContent?`, `requestId?`): `void`

Legacy diagnostic delivery accepts projected or imported evidence.

###### Parameters

###### kind

`string`

###### metadata?

`Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null` \| `undefined`\>\>

###### readContent?

() => `unknown`

###### requestId?

`string`

###### Returns

`void`
