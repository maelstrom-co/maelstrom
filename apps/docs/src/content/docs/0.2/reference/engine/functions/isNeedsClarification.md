---
editUrl: false
next: false
prev: false
title: "isNeedsClarification"
---

> **isNeedsClarification**(`output`): `output is NeedsClarification`

Defined in: packages/engine/src/lib/planner/candidate.ts:173

Whether a planner output is a needs-clarification result rather than a
layout candidate. Layout candidates carry no `type` field. The guard checks
only the `type` discriminant and does not validate `question` or `options`.

## Parameters

### output

`unknown`

## Returns

`output is NeedsClarification`
