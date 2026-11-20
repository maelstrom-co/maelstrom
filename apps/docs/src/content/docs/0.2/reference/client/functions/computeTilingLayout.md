---
editUrl: false
next: false
prev: false
title: "computeTilingLayout"
---

> **computeTilingLayout**(`tree`, `containerRect`, `padding`): readonly [`ComputedTile`](/reference/client/interfaces/computedtile/)[]

Defined in: packages/client/src/lib/chart-manager/tiling.ts:258

Assigns every leaf a rectangle inside `containerRect`.

A split divides its region along its axis in proportion to its weights, so
the children tile it exactly: the cut positions are computed as cumulative
edges and the last edge is the region's own far side, leaving no gap or
overlap for any weighting. `padding` is then inset per leaf, never per
split, so it never accumulates with depth. Empty trees and empty leaves
produce no tile, and padding never yields negative size.

One tile per Instance leaf, with no post-pass. A tree naming the same
Instance twice is refused by the seed validator and by the command
processor, and heal blanks the repeat before it reaches the store, so a
duplicate arriving here means the public API was bypassed.

## Parameters

### tree

[`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/) \| `null`

### containerRect

[`Rect`](/reference/client/interfaces/rect/)

### padding

`number`

## Returns

readonly [`ComputedTile`](/reference/client/interfaces/computedtile/)[]
