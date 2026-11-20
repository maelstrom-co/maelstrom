---
editUrl: false
next: false
prev: false
title: "AssistantMessageResultMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:300

Engine acknowledgement that an assistant-message injection finished.

`requestId` echoes the originating [AcknowledgedAssistantMessage](/reference/protocol/variables/acknowledgedassistantmessage/) `id`
so clients can correlate the result to a waiter. Legacy
[AssistantInjectionMessage](/reference/protocol/variables/assistantinjectionmessage/) requests remain fire-and-forget and do not
receive this frame. `outcome` is load-bearing: `'inserted'` means the engine
stored a new history entry; `'deduped'` means an entry with that id already
existed and nothing was appended. Greeting and other idempotent injectors
branch on that distinction before running side effects such as speech.

## Properties

### outcome

> `readonly` **outcome**: `"inserted"` \| `"deduped"`

Defined in: packages/protocol/src/lib/envelope.ts:308

Whether history grew or already contained the request id.

***

### requestId

> `readonly` **requestId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:304

Echoes the acknowledged request id.

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/envelope.ts:306

Echoes the session whose history was targeted.

***

### type

> `readonly` **type**: `"engine.assistant_message.result"`

Defined in: packages/protocol/src/lib/envelope.ts:302

Identifies the correlated assistant-injection result frame.
