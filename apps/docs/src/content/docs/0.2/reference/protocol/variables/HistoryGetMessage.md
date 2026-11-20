---
editUrl: false
next: false
prev: false
title: "HistoryGetMessage"
---

> **HistoryGetMessage**: (`args`) => [`HistoryGetMessage`](/reference/protocol/interfaces/historygetmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:42

Smart constructor for [HistoryGetMessage](/reference/protocol/variables/historygetmessage/). Generates a fresh `id` via
`MessageId()` when omitted so callers usually pass only the session; the
generated id is what the correlated [HistoryResponseMessage](/reference/protocol/variables/historyresponsemessage/) echoes in
its `requestId`.

## Parameters

### args

#### id?

[`MessageId`](/reference/protocol/type-aliases/messageid/)

#### sessionId

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

## Returns

[`HistoryGetMessage`](/reference/protocol/interfaces/historygetmessage/)
