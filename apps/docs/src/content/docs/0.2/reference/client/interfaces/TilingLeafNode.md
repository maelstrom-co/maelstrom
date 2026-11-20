---
editUrl: false
next: false
prev: false
title: "TilingLeafNode"
---

Defined in: packages/client/src/lib/chart-manager/tiling.ts:85

Leaf node that either names an Instance or reserves empty space.

## Properties

### instanceId

> `readonly` **instanceId**: `InstanceId` \| `null`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:89

Instance occupying the region, or `null` for an empty region.

***

### type

> `readonly` **type**: `"leaf"`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:87

Terminates traversal and allocates the current region.
