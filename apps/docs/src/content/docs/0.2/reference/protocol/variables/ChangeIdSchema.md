---
editUrl: false
next: false
prev: false
title: "ChangeIdSchema"
---

> `const` **ChangeIdSchema**: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ChangeId`](/reference/protocol/type-aliases/changeid/), `string`\>\>

Defined in: packages/protocol/src/lib/agent-ids.ts:108

Wire-format Zod parser for [ChangeId](/reference/protocol/variables/changeid/). Rejects empty and
whitespace-only strings like [ChangeId](/reference/protocol/variables/changeid/) does and carries the brand on
its output.
