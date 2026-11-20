---
editUrl: false
next: false
prev: false
title: "VesselInstanceSnapshot"
---

Defined in: packages/protocol/src/lib/request.ts:119

Snapshot of a Vessel instance's state (for wire transfer).

Hand-written rather than `z.infer<typeof VesselInstanceSnapshotSchema>` so
the `readonly` modifiers survive — `z.infer` does not synthesize them.

## Properties

### instanceId

> `readonly` **instanceId**: [`InstanceId`](/reference/protocol/type-aliases/instanceid/)

Defined in: packages/protocol/src/lib/request.ts:120

***

### variant

> `readonly` **variant**: [`VariantName`](/reference/protocol/type-aliases/variantname/)

Defined in: packages/protocol/src/lib/request.ts:122

***

### vesselId

> `readonly` **vesselId**: [`VesselId`](/reference/protocol/type-aliases/vesselid/)

Defined in: packages/protocol/src/lib/request.ts:121
