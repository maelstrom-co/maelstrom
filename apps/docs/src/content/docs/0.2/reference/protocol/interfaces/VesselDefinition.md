---
editUrl: false
next: false
prev: false
title: "VesselDefinition"
---

Defined in: packages/protocol/src/lib/vessel.ts:208

Author-facing shape for a vessel definition. Distinct from [Vessel](/reference/protocol/type-aliases/vessel/)
(the branded post-validation shape): definitions accept raw string IDs
and variant keys; brands appear after `VesselSchema.parse(...)`.

Use this as the parameter type when accepting a developer-authored vessel
(e.g. `defineVessel`, `registerVessel`). Use [Vessel](/reference/protocol/type-aliases/vessel/) when working
with a vessel that has already crossed the schema boundary.

## Properties

### defaultVariant

> `readonly` **defaultVariant**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:212

***

### description

> `readonly` **description**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:211

***

### id

> `readonly` **id**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:209

***

### name

> `readonly` **name**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:210

***

### variants

> `readonly` **variants**: `Readonly`\<`Record`\<`string`, [`VesselVariantDefinition`](/reference/protocol/interfaces/vesselvariantdefinition/)\>\>

Defined in: packages/protocol/src/lib/vessel.ts:213
