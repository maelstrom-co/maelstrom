---
editUrl: false
next: false
prev: false
title: "CallIdSchema"
---

> `const` **CallIdSchema**: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`CallId`](/reference/protocol/type-aliases/callid/), `string`\>\>

Defined in: packages/protocol/src/lib/agent-ids.ts:71

Wire-format Zod parser for [CallId](/reference/protocol/variables/callid/). Rejects empty and
whitespace-only strings like [CallId](/reference/protocol/variables/callid/) does and carries the brand on
its output.
