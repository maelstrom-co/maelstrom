---
editUrl: false
next: false
prev: false
title: "DiagnosticSubscriptionSchema"
---

> `const` **DiagnosticSubscriptionSchema**: `ZodObject`\<\{ `enabled`: `ZodBoolean`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `includeContent`: `ZodBoolean`; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"client.diagnostics.subscribe"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/diagnostics.ts:54

Subscription sent over an existing Engine connection. Hosts must opt in.
