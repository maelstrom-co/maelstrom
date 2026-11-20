---
editUrl: false
next: false
prev: false
title: "createTilingSplitNode"
---

> **createTilingSplitNode**(`direction`, `children`): [`TilingSplitNode`](/reference/client/interfaces/tilingsplitnode/)

Defined in: packages/client/src/lib/chart-manager/tiling.ts:115

Builds a validated split node.

A weight that is zero, negative or fractional does not fail loudly during
layout: it hands a child a region of zero or negative extent, or a sum that
no longer divides the parent, so the malformed geometry surfaces far from
the code that invented the weight. Guarding the sum is not enough — weights
`[5, -1]` sum to 4 and still overlap.

## Parameters

### direction

[`TilingSplit`](/reference/client/type-aliases/tilingsplit/)

### children

readonly \[\{ `node?`: [`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/); `weight`: `number`; \}, \{ `node?`: [`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/); `weight`: `number`; \}, \{ `node?`: [`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/); `weight`: `number`; \}\]

## Returns

[`TilingSplitNode`](/reference/client/interfaces/tilingsplitnode/)

## Throws

If `children`'s weights violate the split invariant —
see assertValidSplitWeights.
