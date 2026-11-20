---
editUrl: false
next: false
prev: false
title: "VesselCapabilityAction"
---

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:104

An action available on a vessel, deduplicated by name across all of its
variants — the model needs to know what a vessel can do, not which
variant happens to expose the action. Its `parameters` are unioned across
those same variants, so an action never appears to take fewer arguments
than it can.

## Properties

### description

> `readonly` **description**: `string`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:106

***

### name

> `readonly` **name**: `ActionName`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:105

***

### parameters?

> `readonly` `optional` **parameters?**: `NonEmptyArray`\<[`VesselCapabilityParameter`](/reference/client/interfaces/vesselcapabilityparameter/)\>

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:113

Present only when the action declares at least one parameter across its
variants. Absent — rather than empty — for an action that takes no
arguments, since an empty list would read to the model as "accepts an
empty argument list" and invite a call carrying one.
