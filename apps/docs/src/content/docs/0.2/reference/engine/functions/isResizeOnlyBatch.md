---
editUrl: false
next: false
prev: false
title: "isResizeOnlyBatch"
---

> **isResizeOnlyBatch**(`reasons`): `boolean`

Defined in: packages/engine/src/lib/update-reasons.ts:15

Whether every update reason in a batch is a `chart_resize`, so the turn
needs a new layout and no new actions.

An empty batch is not resize-only: nothing triggered the turn, so nothing
should guard it. Empty and mixed batches both collapse into `false`.

This is the single predicate behind the Engine's resize-only execution
turn and a planner's prompt-side instruction, so a prompt that says
"no actions" and an Engine that drops them always agree. Broadening one
side means a second, differently named predicate, not a change here.

## Parameters

### reasons

readonly `UpdateReason`[]

## Returns

`boolean`
