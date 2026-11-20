---
editUrl: false
next: false
prev: false
title: "parseTilingTree"
---

> **parseTilingTree**(`nodes`): [`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/) \| `null`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:150

Builds a tree from the flat preorder token array.

Each split token consumes exactly as many following subtrees as its weights
declare — two for a bare `H` / `V`. Malformed input is reported on the
console and rendered as far as it goes: an unfilled child slot stays
`undefined`, and tokens trailing the first complete root are ignored.
Returns `null` for empty input.

## Parameters

### nodes

readonly `TilingNode`[]

## Returns

[`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/) \| `null`
