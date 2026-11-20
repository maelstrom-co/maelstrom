---
editUrl: false
next: false
prev: false
title: "vessel"
---

Implementation

## Call Signature

> **vessel**\<`V`\>(`definition`, `component`): [`VesselEntry`](/reference/react/interfaces/vesselentry/)\<`V`\>

Defined in: packages/react/src/lib/vessel.ts:12

Register a vessel with an eagerly-loaded component

### Type Parameters

#### V

`V` *extends* `VesselDefinition`

### Parameters

#### definition

`V`

#### component

`ComponentType`\<[`TypedVesselProps`](/reference/react/interfaces/typedvesselprops/)\<`V`\>\>

### Returns

[`VesselEntry`](/reference/react/interfaces/vesselentry/)\<`V`\>

## Call Signature

> **vessel**\<`V`\>(`definition`, `loader`, `loadingComponent`): [`LazyVesselEntry`](/reference/react/interfaces/lazyvesselentry/)\<`V`\>

Defined in: packages/react/src/lib/vessel.ts:18

Register a vessel with a lazily-loaded component

### Type Parameters

#### V

`V` *extends* `VesselDefinition`

### Parameters

#### definition

`V`

#### loader

[`LazyVesselComponentLoader`](/reference/react/type-aliases/lazyvesselcomponentloader/)\<`V`\>

#### loadingComponent

`ComponentType`\<\{ `vesselId`: `VesselId`; \}\>

### Returns

[`LazyVesselEntry`](/reference/react/interfaces/lazyvesselentry/)\<`V`\>
