---
editUrl: false
next: false
prev: false
title: "ComputedTile"
---

Defined in: packages/client/src/lib/chart-manager/tiling.ts:93

Renderable tile computed for one Instance.

## Properties

### instanceId

> `readonly` **instanceId**: `InstanceId`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:98

Instance this tile renders. Not guaranteed distinct across tiles —
disambiguate before using as a collection key.

***

### rect

> `readonly` **rect**: [`Rect`](/reference/client/interfaces/rect/)

Defined in: packages/client/src/lib/chart-manager/tiling.ts:100

Padded pixel-space bounds for the Instance.
