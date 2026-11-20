---
editUrl: false
next: false
prev: false
title: "RunIdSchema"
---

> `const` **RunIdSchema**: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>

Defined in: packages/protocol/src/lib/agent-ids.ts:33

Wire-format Zod parser for [RunId](/reference/protocol/variables/runid/). Rejects empty and whitespace-only
strings like [RunId](/reference/protocol/variables/runid/) does and carries the brand on its output.
