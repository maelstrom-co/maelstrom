---
editUrl: false
next: false
prev: false
title: "AssistantInjectionMessage"
---

Defined in: packages/protocol/src/lib/engine-message.ts:57

An assistant_message envelope: developer-injected content recorded into
session history so subsequent LLM turns have it in context. Does not call
the LLM itself.

## Extends

- [`EngineMessageBase`](/reference/protocol/interfaces/enginemessagebase/)

## Properties

### content

> `readonly` **content**: `string`

Defined in: packages/protocol/src/lib/engine-message.ts:59

***

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/engine-message.ts:38

#### Inherited from

[`EngineMessageBase`](/reference/protocol/interfaces/enginemessagebase/).[`id`](/reference/protocol/interfaces/enginemessagebase/#id)

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

> `readonly` **type**: `"assistant_message"`

Defined in: packages/protocol/src/lib/engine-message.ts:58
