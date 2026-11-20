---
editUrl: false
next: false
prev: false
title: "isTilingLeafTokenString"
---

> **isTilingLeafTokenString**(`value`): `` value is `ID:${string}` ``

Defined in: packages/protocol/src/lib/response.ts:196

Tests whether `value` matches the leaf grammar, for code holding a plain
string rather than a parsed [TilingNode](/reference/protocol/type-aliases/tilingnode/).

The bare prefix does not qualify: `"ID:"` names no Instance, and there is no
repair for an absent identity the way there is for an unreadable weight.

## Parameters

### value

`string`

## Returns

`` value is `ID:${string}` ``
