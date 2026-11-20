---
editUrl: false
next: false
prev: false
title: "HistoryGetMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:42

A `client.history.get` request: asks the engine host to replay the recorded
[SessionHistoryEntry](/reference/protocol/type-aliases/sessionhistoryentry/) list for a session so a resuming client can
rehydrate its chat. The host answers with a [HistoryResponseMessage](/reference/protocol/variables/historyresponsemessage/)
correlated on `id`. Transport-only — it never reaches the LLM, which is why
it lives in the envelope module rather than alongside the `EngineMessage`
variants.

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:44

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/envelope.ts:45

***

### type

> `readonly` **type**: `"client.history.get"`

Defined in: packages/protocol/src/lib/envelope.ts:43
