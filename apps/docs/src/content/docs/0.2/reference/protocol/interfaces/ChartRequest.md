---
editUrl: false
next: false
prev: false
title: "ChartRequest"
---

Defined in: packages/protocol/src/lib/request.ts:132

Request from client to engine.

Message identity (`id`), session binding (`sessionId`), and timestamp live
on the surrounding [ChartRequestMessage](/reference/protocol/variables/chartrequestmessage/) envelope — this payload only
carries the chart state and the reasons for the update.

## Properties

### context

> `readonly` **context**: `object`

Defined in: packages/protocol/src/lib/request.ts:134

#### chartDimensions

> `readonly` **chartDimensions**: [`ChartDimensions`](/reference/protocol/interfaces/chartdimensions/)

#### layoutMode

> `readonly` **layoutMode**: [`LayoutMode`](/reference/protocol/type-aliases/layoutmode/)

#### updateReasons

> `readonly` **updateReasons**: readonly [`UpdateReason`](/reference/protocol/type-aliases/updatereason/)[]

Reasons that triggered this update (can be batched)

***

### instances

> `readonly` **instances**: readonly [`VesselInstanceSnapshot`](/reference/protocol/interfaces/vesselinstancesnapshot/)[]

Defined in: packages/protocol/src/lib/request.ts:141

All Vessel instances with their current variant state

***

### intentFacts?

> `readonly` `optional` **intentFacts?**: `Readonly`\<`Record`\<`string`, [`JsonValue`](/reference/protocol/type-aliases/jsonvalue/)\>\>

Defined in: packages/protocol/src/lib/request.ts:161

Structured facts the caller already learned about the intent, for
example values read from tool results, keyed by a name the Planner can
reason about. They are inputs to planning, not instructions: the Planner
still chooses the Actions and their parameters. Absent means no facts.

***

### layout

> `readonly` **layout**: [`GridLayout`](/reference/protocol/interfaces/gridlayout/) \| [`TilingLayout`](/reference/protocol/interfaces/tilinglayout/)

Defined in: packages/protocol/src/lib/request.ts:145

Current layout (mode-specific)

***

### skipReply?

> `readonly` `optional` **skipReply?**: `boolean`

Defined in: packages/protocol/src/lib/request.ts:154

When `true`, the caller writes the user-facing reply itself, so the
Planner may omit `userMessage` or return a [NeedsClarification](/reference/protocol/interfaces/needsclarification/)
instead of a layout. Absent means `false`: the response carries a
`userMessage`. Clients rendering the reply leave it unset. `Engine.handle`
does not yet ship replyless outcomes: it refuses them with a
`ValidationError` on field `skipReply`.

***

### type

> `readonly` **type**: `"chart_request"`

Defined in: packages/protocol/src/lib/request.ts:133

***

### vessels

> `readonly` **vessels**: readonly `object`[]

Defined in: packages/protocol/src/lib/request.ts:143

All registered Vessel definitions
