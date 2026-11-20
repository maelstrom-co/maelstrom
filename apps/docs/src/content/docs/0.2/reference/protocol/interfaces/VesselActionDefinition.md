---
editUrl: false
next: false
prev: false
title: "VesselActionDefinition"
---

Defined in: packages/protocol/src/lib/vessel.ts:225

Author-facing shape for a [VesselAction](/reference/protocol/type-aliases/vesselaction/). See [VesselDefinition](/reference/protocol/interfaces/vesseldefinition/).

## Properties

### description

> `readonly` **description**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:227

***

### idempotent?

> `readonly` `optional` **idempotent?**: `boolean`

Defined in: packages/protocol/src/lib/vessel.ts:240

Whether re-running this Action with the same parameters leaves the Vessel
in the state a single run would. The Engine may re-emit an Action on a
turn triggered by nothing but a chart resize, and it cannot see Vessel
contents to tell a first run from a repeat; such a turn admits only
actions marked `true` that the model invoked with no parameters, since a
parameter value there could only have come from an earlier turn. Omit the
flag for anything that appends, removes, or otherwise accumulates.
Defaults to `false`.

***

### name

> `readonly` **name**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:226

***

### parameters?

> `readonly` `optional` **parameters?**: readonly `object`[]

Defined in: packages/protocol/src/lib/vessel.ts:228

***

### transitionsTo?

> `readonly` `optional` **transitionsTo?**: `string`

Defined in: packages/protocol/src/lib/vessel.ts:229
