---
editUrl: false
next: false
prev: false
title: "enumSnapshotFor"
---

> **enumSnapshotFor**(`ctx`, `vessels`): [`ActionParameterEnumSnapshot`](/reference/engine/interfaces/actionparameterenumsnapshot/) \| `undefined`

Defined in: packages/engine/src/lib/planner/stage.ts:185

The context's enum snapshot when `vessels` is the catalog it was captured
from; `undefined` for any other catalog, including an equal copy, or a
context without a snapshot.

## Parameters

### ctx

[`StageContext`](/reference/engine/interfaces/stagecontext/)

### vessels

readonly `object`[]

## Returns

[`ActionParameterEnumSnapshot`](/reference/engine/interfaces/actionparameterenumsnapshot/) \| `undefined`
