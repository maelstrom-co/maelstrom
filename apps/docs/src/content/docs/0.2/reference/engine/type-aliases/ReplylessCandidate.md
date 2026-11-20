---
editUrl: false
next: false
prev: false
title: "ReplylessCandidate"
---

> **ReplylessCandidate** = `DeepReadonly`\<`GridResponseWithoutReply`\> \| `DeepReadonly`\<`TilingResponseWithoutReply`\>

Defined in: packages/engine/src/lib/planner/candidate.ts:42

A [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) that may omit `userMessage`, for a request that
set `skipReply: true`. A grid request expects a `GridResponseWithoutReply`;
a tiling request a `TilingResponseWithoutReply`. Without that flag the
Engine rejects a candidate whose `userMessage` is missing or blank. With it,
a supplied `userMessage` is kept unchanged, even when blank.

Every [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) is a `ReplylessCandidate`. Like a
`PlannerCandidate`, it is immutable: validation results are cached per
candidate object.
