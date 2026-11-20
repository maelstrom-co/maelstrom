---
editUrl: false
next: false
prev: false
title: "formatTilingSplitToken"
---

> **formatTilingSplitToken**(`axis`, `weights`): [`TilingSplitToken`](/reference/protocol/type-aliases/tilingsplittoken/)

Defined in: packages/protocol/src/lib/response.ts:336

Renders an axis and weights back into a token.

Emits the bare axis for an even two-way split, so a tree that arrived
unweighted leaves any round trip through the parser unchanged.

The parameter is a two-or-more tuple because a split with fewer children
than that is not a split: `[1]` would render `"V:1"`, which parses back as
an even two-way split and reports itself repaired, breaking the round trip
this function exists to preserve.

## Parameters

### axis

[`TilingSplit`](/reference/protocol/type-aliases/tilingsplit/)

### weights

readonly \[`number`, `number`, `number`\]

## Returns

[`TilingSplitToken`](/reference/protocol/type-aliases/tilingsplittoken/)

## Throws

If `weights` breaks the invariant
  [assertValidSplitWeights](/reference/protocol/functions/assertvalidsplitweights/) enforces: fewer than 2 or more than
  `MAX_SPLIT_CHILDREN` entries, or an entry that is not an integer from 1
  to `MAX_SPLIT_WEIGHT`.
