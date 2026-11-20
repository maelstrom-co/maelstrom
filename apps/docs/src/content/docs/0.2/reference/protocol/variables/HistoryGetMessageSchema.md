---
editUrl: false
next: false
prev: false
title: "HistoryGetMessageSchema"
---

> `const` **HistoryGetMessageSchema**: `ZodObject`\<\{ `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"client.history.get"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:68

Wire-format Zod parser for [HistoryGetMessage](/reference/protocol/variables/historygetmessage/). Validates the
discriminator and the branded `id` / `sessionId` (both rejected when empty
or whitespace-only).
