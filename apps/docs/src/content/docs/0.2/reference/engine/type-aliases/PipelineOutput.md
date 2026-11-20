---
editUrl: false
next: false
prev: false
title: "PipelineOutput"
---

> **PipelineOutput**\<`Out`\> = \[`Out`\] *extends* \[[`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)\] ? [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/) : \[`Out`\] *extends* \[[`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)\] ? [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/) : [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

Defined in: packages/engine/src/lib/planner/candidate.ts:67

The narrowest of [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), [ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) and
[PlannerOutput](/reference/engine/type-aliases/planneroutput/) that contains `Out`. `pipeline` types the planner it
builds with it, so a pipeline whose last stage returns strict candidates
is a plain `Planner`.

## Type Parameters

### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

What the last stage of a planner produces.
