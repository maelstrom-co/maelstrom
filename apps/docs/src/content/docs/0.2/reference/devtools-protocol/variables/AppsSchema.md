---
editUrl: false
next: false
prev: false
title: "AppsSchema"
---

> `const` **AppsSchema**: `ZodObject`\<\{ `apps`: `ZodArray`\<`ZodObject`\<\{ `active`: `ZodBoolean`; `id`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `identity`: `ZodEnum`\<\{ `ambiguous`: `"ambiguous"`; `reported`: `"reported"`; `unavailable`: `"unavailable"`; \}\>; `reportedId`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>\>; `kind`: `ZodLiteral`\<`"apps"`\>; `omitted`: `ZodNumber`; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:144

Bounded app list without application definitions or live state.
