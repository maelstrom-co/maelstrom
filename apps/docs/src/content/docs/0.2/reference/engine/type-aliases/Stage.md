---
editUrl: false
next: false
prev: false
title: "Stage"
---

> **Stage**\<`In`, `Out`\> = (`input`, `ctx`) => `Promise`\<`Result`\<`Out`, [`StageError`](/reference/engine/type-aliases/stageerror/)\>\>

Defined in: packages/engine/src/lib/planner/stage.ts:117

One step of a plan. A stage takes its input and the request context and
resolves to its output, a [Deferred](/reference/engine/interfaces/deferred/), or an [EngineError](/reference/engine/type-aliases/engineerror/). It
must not reject: failures belong in the `Result`.

## Type Parameters

### In

`In`

What the previous stage produced (or [PlanningInput](/reference/engine/interfaces/planninginput/) for the first stage).

### Out

`Out`

What the next stage consumes (or [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) for the last stage).

## Parameters

### input

`In`

### ctx

[`StageContext`](/reference/engine/interfaces/stagecontext/)

## Returns

`Promise`\<`Result`\<`Out`, [`StageError`](/reference/engine/type-aliases/stageerror/)\>\>
