---
editUrl: false
next: false
prev: false
title: "HistoryResponseMessageSchema"
---

> `const` **HistoryResponseMessageSchema**: `ZodObject`\<\{ `entries`: `ZodArray`\<`ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `assistantMessage`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `kind`: `ZodLiteral`\<`"turn"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `userIntent`: `ZodString`; \}, `$strip`\>, `ZodObject`\<\{ `content`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `kind`: `ZodLiteral`\<`"injection"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; \}, `$strip`\>\], `"kind"`\>\>; `requestId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `type`: `ZodLiteral`\<`"engine.history.response"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:283

Wire-format Zod parser for [HistoryResponseMessage](/reference/protocol/variables/historyresponsemessage/). `entries` is
validated with [SessionHistoryEntryArraySchema](/reference/protocol/variables/sessionhistoryentryarrayschema/) so a malformed replay
is rejected at the boundary rather than surfacing deep in a render tree.
