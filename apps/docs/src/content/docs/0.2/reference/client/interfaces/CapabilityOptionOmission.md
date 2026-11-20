---
editUrl: false
next: false
prev: false
title: "CapabilityOptionOmission"
---

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:155

One parameter whose declared enum values are not fully represented in the
projected snapshot, identified well enough to fix the vessel definition.

The snapshot itself only tells the *model* that something is missing (via
[VesselCapabilityParameter.optionsOmitted](/reference/client/interfaces/vesselcapabilityparameter/#optionsomitted)); this is the developer's
side of that signal. Without it an enum that quietly grew past the budget —
or that carries values with no text form — is invisible until the model
starts guessing values it was never offered.

## Properties

### actionName

> `readonly` **actionName**: `ActionName`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:157

***

### budgetExceeded

> `readonly` **budgetExceeded**: `boolean`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:173

Whether the remaining values exceeded
[MAX\_CAPABILITY\_OPTION\_COUNT](/reference/client/variables/max_capability_option_count/) or
[MAX\_CAPABILITY\_OPTIONS\_TOTAL\_CHARS](/reference/client/variables/max_capability_options_total_chars/) and so were omitted as a whole
list rather than truncated.

***

### declaredCount

> `readonly` **declaredCount**: `number`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:160

Values the vessel declared, after merging the enum across variants.

***

### parameterName

> `readonly` **parameterName**: `string`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:158

***

### unrenderableCount

> `readonly` **unrenderableCount**: `number`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:166

How many of those had no faithful text form (a cyclic object,
`undefined`, a symbol, a function) and were dropped rather than rendered
as a placeholder the model could pick but the vessel could not act on.

***

### vesselId

> `readonly` **vesselId**: `VesselId`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:156
