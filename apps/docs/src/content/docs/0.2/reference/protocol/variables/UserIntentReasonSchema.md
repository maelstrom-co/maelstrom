---
editUrl: false
next: false
prev: false
title: "UserIntentReasonSchema"
---

> `const` **UserIntentReasonSchema**: `ZodObject`\<\{ `intent`: `ZodString`; `type`: `ZodLiteral`\<`"user_intent"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:71

Wire-format Zod parser for [UserIntentReason](/reference/protocol/interfaces/userintentreason/). The `type`
discriminator pins the variant; `intent` is an arbitrary natural-language
string with no length constraint (callers may submit empty intents — the
engine prompt builder is responsible for filtering them).
