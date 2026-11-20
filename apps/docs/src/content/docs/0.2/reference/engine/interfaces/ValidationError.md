---
editUrl: false
next: false
prev: false
title: "ValidationError"
---

Defined in: packages/engine/src/lib/errors.ts:52

Raised for generic engine-input validation failures (e.g. a planner that
cannot build its prompt from the request). LLM-output layout problems do
not surface here — they heal into `EngineDiagnostics.droppedLayoutEntries`
instead. A planner's own construction-time misconfiguration does not
surface here either; a planner implementation reports that when it is
constructed, before any request reaches the Engine.

`field` optionally identifies the offending input path as a free-form
symbolic name (e.g. `'prompt'`, `'history'`, `'vessels'` for Action
parameter definitions the Engine cannot snapshot, or `'planner'` for a
planner that deferred with no fallback or threw) — not a structured Zod
path.
For wire-format validation failures with structured access paths, see
[RequestValidationError](/reference/engine/interfaces/requestvalidationerror/) and its `path` field.

`cause` carries the underlying thrown value when this error wraps a caught
throw, so a consumer-supplied `Error` subclass (with its stack and
`Error.cause` chain) survives the boundary. Both `field` and `cause` are
absent — not `undefined` — when the engine synthesizes the failure itself
(e.g. a `history not configured` guard with no upstream throw to attribute).

## Properties

### \_tag

> `readonly` **\_tag**: `"ValidationError"`

Defined in: packages/engine/src/lib/errors.ts:53

***

### cause?

> `readonly` `optional` **cause?**: `unknown`

Defined in: packages/engine/src/lib/errors.ts:56

***

### field?

> `readonly` `optional` **field?**: `string`

Defined in: packages/engine/src/lib/errors.ts:55

***

### message

> `readonly` **message**: `string`

Defined in: packages/engine/src/lib/errors.ts:54

***

### stack?

> `readonly` `optional` **stack?**: `string`

Defined in: packages/engine/src/lib/errors.ts:57
