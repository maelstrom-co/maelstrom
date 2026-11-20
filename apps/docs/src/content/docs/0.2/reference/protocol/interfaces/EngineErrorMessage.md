---
editUrl: false
next: false
prev: false
title: "EngineErrorMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:355

A failure the engine host reports for a request (or for a stream-level fault
with no recoverable request).

`requestId` is optional: a host may fail before it can recover a correlatable
id (e.g. the inbound frame was unparseable), in which case there is no
request to reject and the error is informational. `code` is reserved for a
machine-readable error kind — there is deliberately no closed taxonomy yet,
so consumers must treat an unknown `code` (or its absence) gracefully and
fall back to `error` for display.

## Properties

### code?

> `readonly` `optional` **code?**: `string`

Defined in: packages/protocol/src/lib/envelope.ts:360

***

### error

> `readonly` **error**: `string`

Defined in: packages/protocol/src/lib/envelope.ts:359

***

### requestId?

> `readonly` `optional` **requestId?**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:357

***

### sessionId?

> `readonly` `optional` **sessionId?**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/envelope.ts:358

***

### type

> `readonly` **type**: `"engine.error"`

Defined in: packages/protocol/src/lib/envelope.ts:356
