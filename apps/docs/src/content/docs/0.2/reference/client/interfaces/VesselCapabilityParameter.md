---
editUrl: false
next: false
prev: false
title: "VesselCapabilityParameter"
---

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:39

A parameter an action accepts, as the voice model sees it: what to call it,
what it means, what kind of value it takes, and — when the vessel declared
an enumerated set — which values it will accept.

`options` and `optionsOmitted` combine into exactly four states:
- neither present — unconstrained: any value of `type` is acceptable.
- `options` only — the complete set of values the vessel declared.
- both present — a partial set: everything listed is valid, but at least
  one declared value had no faithful text form and is missing.
- `optionsOmitted` only — values exist but none could be shown: the set
  blew the projection budget, or nothing in it could be rendered.

In the two omitted states `type` is the only remaining signal about the
values that aren't listed, which is why it is always projected.

## Properties

### description

> `readonly` **description**: `string`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:41

***

### name

> `readonly` **name**: `string`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:40

***

### options?

> `readonly` `optional` **options?**: `NonEmptyArray`\<`string`\>

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:63

The values the vessel declared for this parameter, unioned across every
variant that declares the action — so this is a *superset*, not a
per-variant whitelist: it can list values the variant currently on
screen would reject. Read it as "values this parameter can ever take",
never as permission to invoke; the vessel stays the authority on what
its current variant accepts.

Absence means either "any value of `type`" or "declared values that
couldn't be listed" — check
[VesselCapabilityParameter.optionsOmitted](/reference/client/interfaces/vesselcapabilityparameter/#optionsomitted) to tell those apart.
Never empty: an empty list would read as "no valid values exist".

***

### optionsOmitted?

> `readonly` `optional` **optionsOmitted?**: `true`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:76

Set when at least one value the vessel declared is missing from
`options` — either the whole set exceeded the projection budget (so it
was omitted rather than truncated, and `options` is absent) or
individual values had no faithful text form and were dropped (so
`options` holds the rest). Either way `options`, when present, is a
subset rather than the full set.

Distinguishes that from "any value of that kind" — without it a
parameter whose values couldn't be listed is indistinguishable from an
unconstrained one, and the model is told anything goes.

***

### type

> `readonly` **type**: `"string"` \| `"number"` \| `"boolean"` \| `"object"`

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:49

The kind of value this parameter takes, carried through unchanged from
the vessel definition. Always present, including next to a complete
`options` list: for an unconstrained parameter — or one whose options
were omitted — it is the only thing telling the model whether to supply
a string, a number, a boolean or an object.
