---
editUrl: false
next: false
prev: false
title: "HistoryResponseMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:260

The engine host's answer to a [HistoryGetMessage](/reference/protocol/variables/historygetmessage/): the recorded
[SessionHistoryEntry](/reference/protocol/type-aliases/sessionhistoryentry/) list for the requested session. `requestId`
echoes the request `id` for correlation.

## Properties

### entries

> `readonly` **entries**: readonly [`SessionHistoryEntry`](/reference/protocol/type-aliases/sessionhistoryentry/)[]

Defined in: packages/protocol/src/lib/envelope.ts:263

***

### requestId

> `readonly` **requestId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:262

***

### type

> `readonly` **type**: `"engine.history.response"`

Defined in: packages/protocol/src/lib/envelope.ts:261
