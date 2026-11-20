---
editUrl: false
next: false
prev: false
title: "TilingInstance"
---

Defined in: packages/protocol/src/lib/response.ts:54

Retained tiling Instance metadata, whether or not the tree renders it.

## Properties

### instanceId

> `readonly` **instanceId**: [`InstanceId`](/reference/protocol/type-aliases/instanceid/)

Defined in: packages/protocol/src/lib/response.ts:60

Stable retained identity, which may be absent from the tree entirely — a
retained but hidden Instance. When present it names exactly one leaf;
the tree never repeats an instance id.

***

### variant

> `readonly` **variant**: [`VariantName`](/reference/protocol/type-aliases/variantname/)

Defined in: packages/protocol/src/lib/response.ts:64

Current Variant after the response is applied.

***

### vesselId

> `readonly` **vesselId**: [`VesselId`](/reference/protocol/type-aliases/vesselid/)

Defined in: packages/protocol/src/lib/response.ts:62

Vessel implemented by the Instance.
