---
editUrl: false
next: false
prev: false
title: "TilingSplitToken"
---

> **TilingSplitToken** = [`TilingSplit`](/reference/protocol/type-aliases/tilingsplit/) \| [`TilingWeightedSplit`](/reference/protocol/type-aliases/tilingweightedsplit/)

Defined in: packages/protocol/src/lib/tiling-split-token.ts:32

Any token that divides its region: a bare axis or a weighted axis.

Bare `'H'` / `'V'` mean exactly `weights: [1, 1]` and stay the preferred
spelling for an even two-way split.
