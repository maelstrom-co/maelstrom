---
editUrl: false
next: false
prev: false
title: "TilingSplitChild"
---

Defined in: packages/client/src/lib/chart-manager/tiling.ts:67

One child slot of a split, carrying the weight its region is sized by.

The weight travels with the slot rather than in a parallel array, so a split
whose weights and children disagree is unconstructable — the mismatch that
would otherwise hand the last child the wrong fraction of its parent.

## Properties

### node

> `readonly` **node**: [`TilingTreeNode`](/reference/client/type-aliases/tilingtreenode/) \| `undefined`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:81

The subtree filling this slot, or `undefined` where the token array ran
out before the slot could be filled. The region is left empty either way.

***

### weight

> `readonly` **weight**: `number`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:76

Share of the parent region, relative to its siblings' weights.
