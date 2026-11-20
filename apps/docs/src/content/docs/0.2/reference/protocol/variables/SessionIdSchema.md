---
editUrl: false
next: false
prev: false
title: "SessionIdSchema"
---

> `const` **SessionIdSchema**: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>

Defined in: packages/protocol/src/lib/session.ts:44

Wire-format Zod parser for [SessionId](/reference/protocol/variables/sessionid/). Mirrors the
non-empty-string invariant enforced by requireNonEmptyBrand
(rejects `''`, `'   '`, `'\t'`, etc.) and carries the `SessionId`
brand on `z.infer` output so consumer schemas that reference it stay
branded end-to-end.
