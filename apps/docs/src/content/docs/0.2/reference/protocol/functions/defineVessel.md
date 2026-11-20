---
editUrl: false
next: false
prev: false
title: "defineVessel"
---

> **defineVessel**\<`V`\>(`vessel`): `V`

Defined in: packages/protocol/src/lib/vessel.ts:259

Helper to define a vessel while preserving literal types.

Constrains to [VesselDefinition](/reference/protocol/interfaces/vesseldefinition/) (the unbranded author-facing shape)
rather than [Vessel](/reference/protocol/type-aliases/vessel/) so raw string IDs / variant keys / action names
are accepted at definition time. Brands are applied later via
`VesselSchema.parse(...)` at validation seams.

Returns the input shape verbatim (`V`, not widened to `VesselDefinition`)
so downstream type-level helpers can extract literal action-name unions
for typed action runners.

## Type Parameters

### V

`V` *extends* [`VesselDefinition`](/reference/protocol/interfaces/vesseldefinition/)

## Parameters

### vessel

`V`

## Returns

`V`
