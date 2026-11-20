---
editUrl: false
next: false
prev: false
title: "DiagnosticConnectionOptions"
---

Defined in: packages/engine/src/lib/diagnostics.ts:222

Host-owned policy and transport for one diagnostic connection.

## Properties

### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Defined in: packages/engine/src/lib/diagnostics.ts:224

Explicit server opt-in. Defaults to disabled. Production is always disabled.

***

### redact?

> `readonly` `optional` **redact?**: (`value`) => `unknown`

Defined in: packages/engine/src/lib/diagnostics.ts:230

Application-specific redaction before transmitting content or metadata.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### send

> `readonly` **send**: (`frame`) => `void`

Defined in: packages/engine/src/lib/diagnostics.ts:228

Sends a frame through the application's existing connection.

#### Parameters

##### frame

`string`

#### Returns

`void`

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/engine/src/lib/diagnostics.ts:226

Authorized application session for this connection. Every subscription must match it.
