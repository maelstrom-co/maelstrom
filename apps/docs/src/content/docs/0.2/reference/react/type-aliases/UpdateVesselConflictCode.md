---
editUrl: false
next: false
prev: false
title: "UpdateVesselConflictCode"
---

> **UpdateVesselConflictCode** = `"variant_dropped"` \| `"action_dropped"` \| `"batch_in_flight"`

Defined in: packages/react/src/lib/vessel-entry-types.ts:160

Discriminates the recoverable ways `m.updateVessel()` / `handle.update()`
can refuse a republish. See [UpdateVesselConflict](/reference/react/type-aliases/updatevesselconflict/) for the payload
each code carries.
