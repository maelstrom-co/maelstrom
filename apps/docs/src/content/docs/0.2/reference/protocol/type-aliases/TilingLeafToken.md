---
editUrl: false
next: false
prev: false
title: "TilingLeafToken"
---

> **TilingLeafToken** = `` `${typeof TILING_LEAF_PREFIX}${string}` ``

Defined in: packages/protocol/src/lib/response.ts:89

A tiling-tree leaf: [TILING\_LEAF\_PREFIX](/reference/protocol/variables/tiling_leaf_prefix/) followed by the Instance ID
the leaf renders.

The prefix is what makes a leaf a leaf. Without it the grammar would have to
separate leaves from splits by elimination, which puts every Instance whose
ID happens to start `H`/`V` — `"H:hero"`, and `"V"` itself — one string
comparison away from being read as an arity-two divider that consumes the
two subtrees behind it. Marking leaves instead of constraining Instance IDs
keeps the grammar's needs inside the grammar.

The template literal admits `"ID:"` with nothing after it, mirroring
[TilingWeightedSplit](/reference/protocol/type-aliases/tilingweightedsplit/)'s tolerance of a malformed suffix: classifying a
token is separate from reading one, and [tilingLeafInstanceId](/reference/protocol/functions/tilingleafinstanceid/) is
where a leaf's payload is read.
