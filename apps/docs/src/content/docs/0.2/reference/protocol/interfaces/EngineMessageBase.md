---
editUrl: false
next: false
prev: false
title: "EngineMessageBase"
---

Defined in: packages/protocol/src/lib/engine-message.ts:36

Common metadata carried on every message sent to the engine.

Identifies which conversation the message belongs to (`sessionId`) and gives
every message a stable identifier (`id`) used for response correlation,
dedup (assistant_message variants), and audit.

## Extended by

- [`AssistantInjectionMessage`](/reference/protocol/interfaces/assistantinjectionmessage/)
- [`ChartRequestMessage`](/reference/protocol/interfaces/chartrequestmessage/)

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/engine-message.ts:38

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/engine-message.ts:37

***

### timestamp

> `readonly` **timestamp**: `number`

Defined in: packages/protocol/src/lib/engine-message.ts:40

Client-set milliseconds since epoch. Used for audit/trace, not logic.
