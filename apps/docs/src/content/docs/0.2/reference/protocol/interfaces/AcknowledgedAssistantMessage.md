---
editUrl: false
next: false
prev: false
title: "AcknowledgedAssistantMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:81

An opt-in assistant-history injection that requests a correlated
[AssistantMessageResultMessage](/reference/protocol/variables/assistantmessageresultmessage/). It carries the same payload and
validation invariants as the legacy `assistant_message` envelope, but its
distinct transport-only discriminator lets legacy injections remain
fire-and-forget.

## Extends

- `Omit`\<[`AssistantInjectionMessage`](/reference/protocol/interfaces/assistantinjectionmessage/), `"type"`\>

## Properties

### content

> `readonly` **content**: `string`

Defined in: packages/protocol/src/lib/engine-message.ts:59

#### Inherited from

[`AssistantInjectionMessage`](/reference/protocol/interfaces/assistantinjectionmessage/).[`content`](/reference/protocol/interfaces/assistantinjectionmessage/#content)

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

> `readonly` **type**: `"client.assistant_message.acknowledged"`

Defined in: packages/protocol/src/lib/envelope.ts:84

Selects the opt-in, correlated assistant-injection wire path.
