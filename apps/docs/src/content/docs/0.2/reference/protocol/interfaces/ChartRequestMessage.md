---
editUrl: false
next: false
prev: false
title: "ChartRequestMessage"
---

Defined in: packages/protocol/src/lib/engine-message.ts:47

A chart_request envelope: the LLM is asked to produce a layout + execution
plan given the current chart state and accumulated update reasons.

## Extends

- [`EngineMessageBase`](/reference/protocol/interfaces/enginemessagebase/)

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/engine-message.ts:38

#### Inherited from

[`EngineMessageBase`](/reference/protocol/interfaces/enginemessagebase/).[`id`](/reference/protocol/interfaces/enginemessagebase/#id)

***

### request

> `readonly` **request**: [`ChartRequest`](/reference/protocol/interfaces/chartrequest/)

Defined in: packages/protocol/src/lib/engine-message.ts:49

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/engine-message.ts:37

#### Inherited from

[`EngineMessageBase`](/reference/protocol/interfaces/enginemessagebase/).[`sessionId`](/reference/protocol/interfaces/enginemessagebase/#sessionid)

***

### timestamp

> `readonly` **timestamp**: `number`

Defined in: packages/protocol/src/lib/engine-message.ts:40

Client-set milliseconds since epoch. Used for audit/trace, not logic.

#### Inherited from

[`EngineMessageBase`](/reference/protocol/interfaces/enginemessagebase/).[`timestamp`](/reference/protocol/interfaces/enginemessagebase/#timestamp)

***

### type

> `readonly` **type**: `"chart_request"`

Defined in: packages/protocol/src/lib/engine-message.ts:48
