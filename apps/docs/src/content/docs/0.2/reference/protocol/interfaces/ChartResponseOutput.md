---
editUrl: false
next: false
prev: false
title: "ChartResponseOutput"
---

Defined in: packages/protocol/src/lib/engine-output.ts:20

The engine's response to a [ChartRequestMessage](/reference/protocol/interfaces/chartrequestmessage/): layout decisions +
execution plan produced by the LLM, wrapped with the sessionId/id of the
originating request.

## Extends

- [`EngineOutputBase`](/reference/protocol/interfaces/engineoutputbase/)

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/engine-output.ts:12

#### Inherited from

[`EngineOutputBase`](/reference/protocol/interfaces/engineoutputbase/).[`id`](/reference/protocol/interfaces/engineoutputbase/#id)

***

### response

> `readonly` **response**: [`MaelstromResponse`](/reference/protocol/interfaces/maelstromresponse/)

Defined in: packages/protocol/src/lib/engine-output.ts:22

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/engine-output.ts:11

#### Inherited from

[`EngineOutputBase`](/reference/protocol/interfaces/engineoutputbase/).[`sessionId`](/reference/protocol/interfaces/engineoutputbase/#sessionid)

***

### type

> `readonly` **type**: `"chart_response"`

Defined in: packages/protocol/src/lib/engine-output.ts:21
