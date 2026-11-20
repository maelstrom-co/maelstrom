---
editUrl: false
next: false
prev: false
title: "isTilingSplit"
---

> **isTilingSplit**(`node`): `node is TilingSplitToken`

Defined in: packages/protocol/src/lib/response.ts:185

True iff the node divides its region rather than naming an Instance.

Claims every token with an `H` / `V` axis prefix, including one whose weight
suffix is malformed, so classification precedes interpretation.

## Parameters

### node

[`TilingNode`](/reference/protocol/type-aliases/tilingnode/)

## Returns

`node is TilingSplitToken`
