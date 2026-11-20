---
editUrl: false
next: false
prev: false
title: "UpdateVesselPayload"
---

> **UpdateVesselPayload**\<`T`, `Id`\> = [`RepublishableVessel`](/reference/react/type-aliases/republishablevessel/)\<`ExtractVesselByIdFromEntries`\<`T`, `Id`\>\> & `object`

Defined in: packages/react/src/lib/vessel-entry-types.ts:150

Payload type for `m.updateVessel({ id, ... })` — `Id` must be one of the
vessel IDs declared in `createMaelstrom({ vessels })`, so a typo'd or
runtime-only id fails to compile instead of silently skipping the
`RepublishableVessel` shape check.

`T` only knows the vessels declared in `createMaelstrom({ vessels })` —
`registerVessel()` adds ids at runtime that never appear in `T`, so
`m.updateVessel()` cannot name them. Republish a runtime-registered
vessel through `handle.update()` on the handle `registerVessel()`
returns instead — it is typed exactly to that call's inferred vessel
definition, with no id lookup needed.

## Type Declaration

### id

> **id**: `Id`

## Type Parameters

### T

`T` *extends* readonly `AnyVesselEntry`[]

### Id

`Id` *extends* [`VesselIds`](/reference/react/type-aliases/vesselids/)\<`T`\>
