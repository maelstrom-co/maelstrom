---
editUrl: false
next: false
prev: false
title: "DiagnosticConnection"
---

Defined in: packages/engine/src/lib/diagnostics.ts:234

Connection-owned frame handler with bounded, opt-in diagnostic forwarding.

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/engine/src/lib/diagnostics.ts:238

Releases the Engine subscription when the connection closes.

#### Returns

`void`

***

### handle()

> **handle**(`raw`): `Promise`\<`string` \| `null`\>

Defined in: packages/engine/src/lib/diagnostics.ts:236

Handles subscription frames or delegates normal Engine frames.

#### Parameters

##### raw

`unknown`

#### Returns

`Promise`\<`string` \| `null`\>
