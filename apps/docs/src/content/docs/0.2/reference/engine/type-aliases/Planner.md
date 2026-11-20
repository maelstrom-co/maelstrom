---
editUrl: false
next: false
prev: false
title: "Planner"
---

> **Planner** = [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)\>

Defined in: packages/engine/src/lib/planner/stage.ts:133

A complete plan for one `chart_request`: a stage from the Engine's input
to a candidate it can validate. Only these two ends are fixed; the types
between stages belong to whoever composes them with [pipeline](/reference/engine/functions/pipeline/).

One planner serves every session and concurrent request of an Engine, so
any state it keeps across calls must be keyed by the request (or session)
and safe under concurrent calls. State from one request must never affect
another; a per-request cache belongs in a `WeakMap` keyed by
`input.request`, for example.
