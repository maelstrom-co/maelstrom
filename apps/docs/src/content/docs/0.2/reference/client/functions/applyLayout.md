---
editUrl: false
next: false
prev: false
title: "applyLayout"
---

> **applyLayout**(`layout`, `existingInstances?`): `Map`\<`InstanceId`, [`VesselInstance`](/reference/client/interfaces/vesselinstance/)\>

Defined in: packages/client/src/lib/command-processor/layout-manager.ts:19

Converts a server layout into a Map of VesselInstances.

Pure function — no store dependency, no side effects.
The caller is responsible for writing the result to state.

## Parameters

### layout

`GridLayout` \| `TilingLayout`

The layout from the server response

### existingInstances?

`Map`\<`InstanceId`, [`VesselInstance`](/reference/client/interfaces/vesselinstance/)\>

Current instances map, used by grid layout
  to preserve vesselId and variant (which GridPosition does not carry)

## Returns

`Map`\<`InstanceId`, [`VesselInstance`](/reference/client/interfaces/vesselinstance/)\>
