---
editUrl: false
next: false
prev: false
title: "MessageIdSchema"
---

> `const` **MessageIdSchema**: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>

Defined in: packages/protocol/src/lib/message.ts:47

Wire-format Zod parser for [MessageId](/reference/protocol/variables/messageid/). Mirrors the
non-empty-string invariant enforced by requireNonEmptyBrand
(rejects `''`, `'   '`, `'\t'`, etc.) and carries the `MessageId`
brand on `z.infer` output so consumer schemas that reference it stay
branded end-to-end.
