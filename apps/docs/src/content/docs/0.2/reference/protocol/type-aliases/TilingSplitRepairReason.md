---
editUrl: false
next: false
prev: false
title: "TilingSplitRepairReason"
---

> **TilingSplitRepairReason** = `"truncated"` \| `"unreadable"` \| `"padded"`

Defined in: packages/protocol/src/lib/response.ts:106

Why a parsed split's `weights` differ from what its token spelled.

`'truncated'` is a structural event and the others are not: the token
declared more children than a split may have, so the subtrees the discarded
slots would have consumed are re-parented onto an ancestor. `'unreadable'`
means a weight field was not spelled as the grammar requires and a
substitute value stands in its place. `'padded'` means the token declared
fewer than two weights, so the arity — not any declared value — was filled
in. Truncation is reported ahead of the other two when a token manages
both, because re-parenting is the consequential half.
