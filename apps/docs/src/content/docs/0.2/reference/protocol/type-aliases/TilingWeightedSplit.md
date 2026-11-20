---
editUrl: false
next: false
prev: false
title: "TilingWeightedSplit"
---

> **TilingWeightedSplit** = `` `${TilingSplit}:${string}` ``

Defined in: packages/protocol/src/lib/tiling-split-token.ts:24

A split token carrying an explicit weight suffix: an axis, a colon, then
comma-separated positive integers — `"V:1,1,1"`, `"H:2,1"`.

The weight count **declares the token's arity**. `"V:1,1,1"` consumes the
next three subtrees from the preorder array, not two, and each child takes
`weight / sum(weights)` of the parent region.

A weight is a share relative to its siblings, not a fraction of the parent,
so any uniform scaling is a no-op: `1,1,1` and `2,2,2` are both exact
thirds. Weights are integers because integers keep the validity predicate
total — no NaN, no float-precision edge cases — and because a decimal field
is not interpreted: [parseTilingSplitToken](/reference/protocol/functions/parsetilingsplittoken/) rounds it to the nearest
integer with a floor of 1, so `"V:0.7,0.3"` reads as an even two-way split
and reports itself repaired.

The template literal admits any suffix, including malformed ones, so that a
prefixed token is never mistaken for an Instance ID leaf.
[parseTilingSplitToken](/reference/protocol/functions/parsetilingsplittoken/) is where a suffix is interpreted.
