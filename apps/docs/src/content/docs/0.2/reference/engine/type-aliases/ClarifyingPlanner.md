---
editUrl: false
next: false
prev: false
title: "ClarifyingPlanner"
---

> **ClarifyingPlanner** = [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)\>

Defined in: packages/engine/src/lib/planner/stage.ts:143

A [Planner](/reference/engine/type-aliases/planner/) that may also answer with a [ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) or
a needs-clarification result: any [PlannerOutput](/reference/engine/type-aliases/planneroutput/). Every `Planner` is
a `ClarifyingPlanner`. Validation accepts a missing `userMessage` and a
clarification only for a request that set `skipReply: true`, and
`Engine.handle` currently refuses both even then with
`Err(ValidationError)` on field `skipReply`.
