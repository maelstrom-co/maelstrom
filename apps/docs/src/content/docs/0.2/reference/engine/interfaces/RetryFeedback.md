---
editUrl: false
next: false
prev: false
title: "RetryFeedback"
---

Defined in: packages/engine/src/lib/planner/stage.ts:153

Why the previous attempt of a [withRetry](/reference/engine/functions/withretry/)-wrapped stage was rejected.
Present only on retries.

## Type Parameters

### Candidate

`Candidate` *extends* [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/) = [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)

What the wrapped stage produces as a candidate:
  [PlannerCandidate](/reference/engine/type-aliases/plannercandidate/) by default, or [ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) for a
  stage that may omit `userMessage` or ask for clarification.

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: packages/engine/src/lib/planner/stage.ts:157

Retry number: 1 for the first retry.

***

### diagnostics

> `readonly` **diagnostics**: [`EngineDiagnostics`](/reference/engine/interfaces/enginediagnostics/)

Defined in: packages/engine/src/lib/planner/stage.ts:161

Heal diagnostics for [previous](/reference/engine/interfaces/retryfeedback/#previous), which recommended the retry.

***

### previous

> `readonly` **previous**: `Candidate`

Defined in: packages/engine/src/lib/planner/stage.ts:159

The candidate the previous attempt produced. Build a new candidate rather than editing it.
