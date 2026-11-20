---
editUrl: false
next: false
prev: false
title: "PlannerOutput"
---

> **PlannerOutput** = [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/) \| [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/) \| `NeedsClarification`

Defined in: packages/engine/src/lib/planner/candidate.ts:54

Everything a planner may return: a [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), a
[ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/), or a NeedsClarification when it cannot
proceed without asking the user. Validation accepts a replyless candidate
without `userMessage` and a needs-clarification result only for a request
that set `skipReply: true`, and `Engine.handle` currently refuses both even
then with `Err(ValidationError)` on field `skipReply`.
