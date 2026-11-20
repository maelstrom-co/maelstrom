---
editUrl: false
next: false
prev: false
title: "MaelstromResponse"
---

Defined in: packages/protocol/src/lib/response.ts:542

Healed Chart decision whose layout is applied before its Action plan.

## Properties

### executionPlan

> `readonly` **executionPlan**: readonly [`ActionExecution`](/reference/protocol/interfaces/actionexecution/)[]

Defined in: packages/protocol/src/lib/response.ts:552

Applied after layout; order is preserved only within each target Instance.

***

### layout

> `readonly` **layout**: [`GridLayout`](/reference/protocol/interfaces/gridlayout/) \| [`TilingLayout`](/reference/protocol/interfaces/tilinglayout/)

Defined in: packages/protocol/src/lib/response.ts:554

Uses the same mode requested in the Chart context after successful healing.

***

### rationale

> `readonly` **rationale**: `string`

Defined in: packages/protocol/src/lib/response.ts:550

Engine rationale intended for diagnostics rather than user display.

***

### requestId

> `readonly` **requestId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/response.ts:546

Echoes the input message ID and matches the enclosing output correlation ID.

***

### type

> `readonly` **type**: `"maelstrom_response"`

Defined in: packages/protocol/src/lib/response.ts:544

Wire discriminator for a Maelstrom Chart response.

***

### userMessage

> `readonly` **userMessage**: `string`

Defined in: packages/protocol/src/lib/response.ts:548

Assistant text intended for display and optional speech output.
