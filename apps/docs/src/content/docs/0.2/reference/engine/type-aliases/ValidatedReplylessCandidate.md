---
editUrl: false
next: false
prev: false
title: "ValidatedReplylessCandidate"
---

> **ValidatedReplylessCandidate** = `Omit`\<`MaelstromResponse`, `"userMessage"`\> & `object`

Defined in: packages/engine/src/lib/planner/candidate.ts:117

A [ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) after the Engine healed and validated it: a
[ValidatedCandidate](/reference/engine/type-aliases/validatedcandidate/) whose `userMessage` may be absent.

## Type Declaration

### diagnostics

> `readonly` **diagnostics**: [`EngineDiagnostics`](/reference/engine/interfaces/enginediagnostics/)

What healing changed, and whether a retry is recommended.

### userMessage?

> `readonly` `optional` **userMessage?**: `string`

The reply to the user. Always present and non-blank unless the request
set `skipReply: true`, in which case the planner may have omitted it and
a supplied reply passes through unchanged, even when blank. The Engine
refuses an absent or blank reply at the ship boundary.
