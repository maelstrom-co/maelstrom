---
editUrl: false
next: false
prev: false
title: "isTilingSplitTokenString"
---

> **isTilingSplitTokenString**(`value`): `value is TilingSplitToken`

Defined in: packages/protocol/src/lib/tiling-split-token.ts:41

Tests whether `value` matches the split-token grammar — a bare axis or a
weighted axis — as opposed to an Instance ID leaf.

This is the one definition of what a split token looks like, for code
holding a plain string rather than a parsed `TilingNode`.

## Parameters

### value

`string`

## Returns

`value is TilingSplitToken`
