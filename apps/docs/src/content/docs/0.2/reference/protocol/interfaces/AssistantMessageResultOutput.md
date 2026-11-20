---
editUrl: false
next: false
prev: false
title: "AssistantMessageResultOutput"
---

Defined in: packages/protocol/src/lib/engine-output.ts:32

Result of an assistant_message submission. `outcome` tells the caller
whether this specific call wrote a new entry (`'inserted'`) or was a
dedup no-op against an existing entry with the same [MessageId](/reference/protocol/variables/messageid/)
(`'deduped'`). The history write itself is always idempotent; this field
only reports which branch happened so callers can instrument behavior.

## Extends

- [`EngineOutputBase`](/reference/protocol/interfaces/engineoutputbase/)

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/engine-output.ts:12

#### Inherited from

[`EngineOutputBase`](/reference/protocol/interfaces/engineoutputbase/).[`id`](/reference/protocol/interfaces/engineoutputbase/#id)

***

### outcome

> `readonly` **outcome**: `"inserted"` \| `"deduped"`

Defined in: packages/protocol/src/lib/engine-output.ts:34

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/engine-output.ts:11

#### Inherited from

[`EngineOutputBase`](/reference/protocol/interfaces/engineoutputbase/).[`sessionId`](/reference/protocol/interfaces/engineoutputbase/#sessionid)

***

### type

> `readonly` **type**: `"assistant_message_result"`

Defined in: packages/protocol/src/lib/engine-output.ts:33
