---
editUrl: false
next: false
prev: false
title: "EngineDiagnostics"
---

Defined in: packages/engine/src/lib/planner/candidate.ts:81

A summary of what healing changed in a candidate and whether another
attempt is worth it. Planner stages see it through `StageContext.validate`
and `RetryFeedback`; it is stripped from the response before it crosses the
Engine boundary. The detailed per-entry records stay inside the Engine.

## Properties

### counts

> `readonly` **counts**: `object`

Defined in: packages/engine/src/lib/planner/candidate.ts:87

How many entries of each kind healing produced.

#### droppedLayoutEntries

> `readonly` **droppedLayoutEntries**: `number`

Layout entries healing removed.

#### skippedActions

> `readonly` **skippedActions**: `number`

Proposed actions the Engine refused to plan.

#### warnings

> `readonly` **warnings**: `number`

Repairs healing applied without removing anything from the layout.

***

### feedback

> `readonly` **feedback**: `string`

Defined in: packages/engine/src/lib/planner/candidate.ts:100

Sanitized, length-limited description of what healing changed, written
for a model and ready to paste into a retry prompt. Empty when there is
nothing a planner can act on.

***

### planIssues?

> `readonly` `optional` **planIssues?**: readonly [`PlanValidationIssue`](/reference/engine/interfaces/planvalidationissue/)[]

Defined in: packages/engine/src/lib/planner/candidate.ts:83

Unmet application requirements; absent when no hook is configured.

***

### retryHint

> `readonly` **retryHint**: [`RetryHint`](/reference/engine/type-aliases/retryhint/)

Defined in: packages/engine/src/lib/planner/candidate.ts:85

Severity of the healed result and whether the Engine recommends a retry.
