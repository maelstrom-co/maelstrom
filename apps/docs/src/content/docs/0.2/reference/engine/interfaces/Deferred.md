---
editUrl: false
next: false
prev: false
title: "Deferred"
---

Defined in: packages/engine/src/lib/planner/stage.ts:47

A stage abstaining from the request. Deferral is a value in the error
channel, never a thrown exception, and is distinct from every
[EngineError](/reference/engine/type-aliases/engineerror/) so that [withFallback](/reference/engine/functions/withfallback/) can recover from it alone.

## Properties

### \_tag

> `readonly` **\_tag**: `"Deferred"`

Defined in: packages/engine/src/lib/planner/stage.ts:49

Discriminator shared with the `EngineError` variants.

***

### reason

> `readonly` **reason**: `string`

Defined in: packages/engine/src/lib/planner/stage.ts:51

Why the stage abstained, for logs.
