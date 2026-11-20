---
editUrl: false
next: false
prev: false
title: "PlanValidationInput"
---

Defined in: packages/engine/src/lib/planner/plan-validator.ts:12

Read-only inputs for application-owned plan validation.

## Properties

### request

> `readonly` **request**: `ChartRequest`

Defined in: packages/engine/src/lib/planner/plan-validator.ts:14

The original client request, even when a planner narrows its input.

***

### response

> `readonly` **response**: `MaelstromResponse`

Defined in: packages/engine/src/lib/planner/plan-validator.ts:16

The healed layout and accepted Actions that would reach the client.
