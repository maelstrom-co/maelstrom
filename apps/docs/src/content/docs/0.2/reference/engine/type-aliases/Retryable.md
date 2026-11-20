---
editUrl: false
next: false
prev: false
title: "Retryable"
---

> **Retryable**\<`In`, `Candidate`\> = `In` & `object`

Defined in: packages/engine/src/lib/planner/stage.ts:172

A stage input that [withRetry](/reference/engine/functions/withretry/) may annotate with feedback about the
previous attempt. `retry` is absent on the first attempt.

## Type Declaration

### retry?

> `readonly` `optional` **retry?**: [`RetryFeedback`](/reference/engine/interfaces/retryfeedback/)\<`Candidate`\>

Feedback about the previous attempt; absent on the first attempt.

## Type Parameters

### In

`In`

The input the stage receives on its first attempt.

### Candidate

`Candidate` *extends* [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/) = [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)

The candidate type [RetryFeedback.previous](/reference/engine/interfaces/retryfeedback/#previous)
  carries: [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) by default.
