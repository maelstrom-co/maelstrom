---
editUrl: false
next: false
prev: false
title: "TilingSplitNode"
---

Defined in: packages/client/src/lib/chart-manager/tiling.ts:36

Split node dividing the current rectangle along its axis, each child taking
a share proportional to its weight.

[createTilingSplitNode](/reference/client/functions/createtilingsplitnode/) and [parseTilingTree](/reference/client/functions/parsetilingtree/) are the only ways
to reach this type without an assertion, so a split that reaches layout has
had its weights checked.

## Properties

### children

> `readonly` **children**: readonly \[[`TilingSplitChild`](/reference/client/interfaces/tilingsplitchild/), [`TilingSplitChild`](/reference/client/interfaces/tilingsplitchild/), [`TilingSplitChild`](/reference/client/interfaces/tilingsplitchild/)\]

Defined in: packages/client/src/lib/chart-manager/tiling.ts:53

One entry per child slot the token declared, so `children.length` is the
split's arity. A bare `H` / `V` token yields two slots weighted `1` each,
and a split of fewer than two slots is unconstructable.

***

### direction

> `readonly` **direction**: [`TilingSplit`](/reference/client/type-aliases/tilingsplit/)

Defined in: packages/client/src/lib/chart-manager/tiling.ts:47

`H` divides top/bottom; `V` divides left/right.

***

### type

> `readonly` **type**: `"split"`

Defined in: packages/client/src/lib/chart-manager/tiling.ts:45

Selects recursive weighted traversal of the child slots.
