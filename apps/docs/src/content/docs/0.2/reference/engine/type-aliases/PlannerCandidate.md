---
editUrl: false
next: false
prev: false
title: "PlannerCandidate"
---

> **PlannerCandidate** = `DeepReadonly`\<`GridResponse`\> \| `DeepReadonly`\<`TilingResponse`\>

Defined in: packages/engine/src/lib/planner/candidate.ts:27

The raw plan a planner produces: the structured output shape for the
request's layout mode, before the Engine heals and validates it. A grid
request expects a `GridResponse`; a tiling request a `TilingResponse`.

A candidate is immutable. Validation results are cached per candidate
object, so a stage that wants a different plan must return a new object
rather than edit one it received or already validated.
