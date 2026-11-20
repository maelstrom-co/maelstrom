---
editUrl: false
next: false
prev: false
title: "MaelstromResponseMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:220

The engine host's answer to a `chart_request`: the LLM's decision output.
`requestId` echoes the originating message `id` for correlation; `sessionId`
is optional because a stateless host may not thread it back. The `response`
payload is a full [MaelstromResponse](/reference/protocol/interfaces/maelstromresponse/).

## Properties

### requestId

> `readonly` **requestId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:222

***

### response

> `readonly` **response**: [`MaelstromResponse`](/reference/protocol/interfaces/maelstromresponse/)

Defined in: packages/protocol/src/lib/envelope.ts:224

***

### sessionId?

> `readonly` `optional` **sessionId?**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/envelope.ts:223

***

### type

> `readonly` **type**: `"engine.maelstrom.response"`

Defined in: packages/protocol/src/lib/envelope.ts:221
