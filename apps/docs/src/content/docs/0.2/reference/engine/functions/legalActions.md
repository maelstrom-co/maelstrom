---
editUrl: false
next: false
prev: false
title: "legalActions"
---

> **legalActions**(`vesselId`, `variant`, `vessels`): readonly `object`[]

Defined in: packages/engine/src/lib/response/execution-plan/final-variants.ts:88

The actions an instance of `vesselId` offers while in `variant`: the
variant's declared actions, in declaration order. Empty when the Vessel or
the variant is not in `vessels`.

## Parameters

### vesselId

`VesselId`

### variant

`VariantName`

### vessels

readonly `object`[]

## Returns

readonly `object`[]
