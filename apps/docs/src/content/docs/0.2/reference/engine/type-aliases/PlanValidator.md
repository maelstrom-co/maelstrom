---
editUrl: false
next: false
prev: false
title: "PlanValidator"
---

> **PlanValidator** = (`input`) => readonly [`PlanValidationIssue`](/reference/engine/interfaces/planvalidationissue/)[]

Defined in: packages/engine/src/lib/planner/plan-validator.ts:31

Checks explicit application requirements after Engine healing. Return an empty
array to accept the response. Issues join the existing bounded retry feedback;
unresolved issues prevent the Engine from shipping the final response.
Outcomes without a nonblank userMessage bypass this hook, as do clarification
results. The Engine refuses these outcomes at its delivery boundary.

Runs synchronously at most once per candidate object per request. Keep it
deterministic and side-effect free; never mutate its inputs. Promises and
malformed returns produce a ValidationError without consuming retry budget.
The application owns requirement selection; the Engine does not infer intent.

## Parameters

### input

[`PlanValidationInput`](/reference/engine/interfaces/planvalidationinput/)

## Returns

readonly [`PlanValidationIssue`](/reference/engine/interfaces/planvalidationissue/)[]
