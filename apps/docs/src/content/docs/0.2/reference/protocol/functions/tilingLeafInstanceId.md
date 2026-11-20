---
editUrl: false
next: false
prev: false
title: "tilingLeafInstanceId"
---

> **tilingLeafInstanceId**(`node`): [`InstanceId`](/reference/protocol/type-aliases/instanceid/) \| `null`

Defined in: packages/protocol/src/lib/response.ts:225

Reads the Instance a leaf names, or returns null for a node that is not a
leaf token.

The counterpart of [parseTilingSplitToken](/reference/protocol/functions/parsetilingsplittoken/): a node that yields neither
an Instance here nor a split there occupies its slot as empty space.

## Parameters

### node

[`TilingNode`](/reference/protocol/type-aliases/tilingnode/)

## Returns

[`InstanceId`](/reference/protocol/type-aliases/instanceid/) \| `null`
