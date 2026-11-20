---
editUrl: false
next: false
prev: false
title: "AcknowledgedAssistantMessageSchema"
---

> `const` **AcknowledgedAssistantMessageSchema**: `ZodObject`\<\{ `content`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `type`: `ZodLiteral`\<`"client.assistant_message.acknowledged"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:117

Wire parser for [AcknowledgedAssistantMessage](/reference/protocol/variables/acknowledgedassistantmessage/). Reuses the legacy
assistant payload schema so both request forms enforce branded non-empty ids,
a finite timestamp, and non-empty content identically.
