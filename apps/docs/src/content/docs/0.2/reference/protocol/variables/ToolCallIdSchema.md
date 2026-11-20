---
editUrl: false
next: false
prev: false
title: "ToolCallIdSchema"
---

> `const` **ToolCallIdSchema**: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ToolCallId`](/reference/protocol/type-aliases/toolcallid/), `string`\>\>

Defined in: packages/protocol/src/lib/tool-call-id.ts:40

Wire-format Zod parser for [ToolCallId](/reference/protocol/variables/toolcallid/). Mirrors the
non-empty-string invariant enforced by requireNonEmptyBrand
(rejects `''`, `'   '`, `'\t'`, etc.) and carries the `ToolCallId`
brand on `z.infer` output so consumer schemas that reference it stay
branded end-to-end.
