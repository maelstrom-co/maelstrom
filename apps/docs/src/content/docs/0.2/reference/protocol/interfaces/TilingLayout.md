---
editUrl: false
next: false
prev: false
title: "TilingLayout"
---

Defined in: packages/protocol/src/lib/response.ts:469

Tiling layout with separate tree visibility and retained Instance metadata.

## Properties

### instances

> `readonly` **instances**: readonly [`TilingInstance`](/reference/protocol/interfaces/tilinginstance/)[]

Defined in: packages/protocol/src/lib/response.ts:475

Complete retained set, including Instances hidden by omission from the tree.

***

### tree

> `readonly` **tree**: readonly [`TilingNode`](/reference/protocol/type-aliases/tilingnode/)[]

Defined in: packages/protocol/src/lib/response.ts:473

First preorder root controls visibility; `null` reserves an empty region.

***

### type

> `readonly` **type**: `"tiling"`

Defined in: packages/protocol/src/lib/response.ts:471

Must agree with the request's `layoutMode`.
