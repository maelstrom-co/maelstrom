---
editUrl: false
next: false
prev: false
title: "UpdateVesselConflict"
---

> **UpdateVesselConflict** = \{ `code`: `"variant_dropped"`; `instanceId`: `InstanceId`; `message`: `string`; `variant`: `VariantName`; `vesselId`: `VesselId`; \} \| \{ `code`: `"action_dropped"`; `instanceId`: `InstanceId`; `message`: `string`; `missingActionNames`: readonly `ActionName`[]; `variant`: `VariantName`; `vesselId`: `VesselId`; \} \| \{ `code`: `"batch_in_flight"`; `message`: `string`; `vesselId`: `VesselId`; \}

Defined in: packages/react/src/lib/vessel-entry-types.ts:182

The recoverable reason a republish did not commit — returned as data by
`m.updateVessel()` / `handle.update()`, never thrown.

`'variant_dropped'` and `'action_dropped'` are ordinary, user-triggerable
states, not programmer mistakes — for example a `detail` variant that
only exists while its record does, and the user just deleted that
record. `'batch_in_flight'` means a command batch was already queued or
executing when the republish was attempted: CommandProcessor applies
`set_layout` / `execute_actions` through an async queue, so the instance
snapshot a conflict scan would read from is not yet trustworthy — that
in-flight batch could still land an instance on a variant the republish
is about to drop.

Branch on `code`, not on `message` text, which this package is free to
reword.
