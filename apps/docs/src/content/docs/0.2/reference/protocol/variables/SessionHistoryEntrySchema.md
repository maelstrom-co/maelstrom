---
editUrl: false
next: false
prev: false
title: "SessionHistoryEntrySchema"
---

> `const` **SessionHistoryEntrySchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `assistantMessage`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `kind`: `ZodLiteral`\<`"turn"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `userIntent`: `ZodString`; \}, `$strip`\>, `ZodObject`\<\{ `content`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `kind`: `ZodLiteral`\<`"injection"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; \}, `$strip`\>\], `"kind"`\>

Defined in: packages/protocol/src/lib/session-history-entry.ts:99

Wire-format Zod parser for [SessionHistoryEntry](/reference/protocol/type-aliases/sessionhistoryentry/). Dispatches on
`kind` and validates the per-variant payload.

Empty `userIntent` / `assistantMessage` / `content` are *allowed* — they
are legal values with semantic meaning (an injection of `''` is rejected
upstream by `AssistantInjectionMessageSchema`, but a `turn` recorded with
no user-intent reasons legitimately has `userIntent: ''`).
