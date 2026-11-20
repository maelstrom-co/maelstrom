---
editUrl: false
next: false
prev: false
title: "SessionHistoryEntryArraySchema"
---

> `const` **SessionHistoryEntryArraySchema**: `ZodArray`\<`ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `assistantMessage`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `kind`: `ZodLiteral`\<`"turn"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `userIntent`: `ZodString`; \}, `$strip`\>, `ZodObject`\<\{ `content`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `kind`: `ZodLiteral`\<`"injection"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; \}, `$strip`\>\], `"kind"`\>\>

Defined in: packages/protocol/src/lib/session-history-entry.ts:111

Wire-format Zod parser for an array of [SessionHistoryEntry](/reference/protocol/type-aliases/sessionhistoryentry/). The
shape returned by `Engine.getHistory` and the connector layer's `getHistory`
methods. Co-located with the singular schema so wire-shape definitions stay
in one place — connectors `safeParse` against this directly instead of
each declaring its own `z.array(SessionHistoryEntrySchema)`.
