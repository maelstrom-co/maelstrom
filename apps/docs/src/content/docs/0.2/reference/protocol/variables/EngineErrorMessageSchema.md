---
editUrl: false
next: false
prev: false
title: "EngineErrorMessageSchema"
---

> `const` **EngineErrorMessageSchema**: `ZodObject`\<\{ `code`: `ZodOptional`\<`ZodString`\>; `error`: `ZodString`; `requestId`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>\>; `sessionId`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>\>; `type`: `ZodLiteral`\<`"engine.error"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:385

Wire-format Zod parser for [EngineErrorMessage](/reference/protocol/variables/engineerrormessage/). `requestId` /
`sessionId` / `code` are all optional; `error` is a required string.
