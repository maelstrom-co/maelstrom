---
editUrl: false
next: false
prev: false
title: "NeedsClarificationSchema"
---

> `const` **NeedsClarificationSchema**: `ZodObject`\<\{ `options`: `ZodOptional`\<`ZodArray`\<`ZodString`\>\>; `question`: `ZodString`; `type`: `ZodLiteral`\<`"needs_clarification"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/needs-clarification.ts:28

Wire-format Zod parser for [NeedsClarification](/reference/protocol/interfaces/needsclarification/). Rejects a blank
`question` and any blank or non-string entry in `options`.
