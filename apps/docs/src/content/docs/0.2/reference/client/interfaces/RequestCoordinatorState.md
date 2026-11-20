---
editUrl: false
next: false
prev: false
title: "RequestCoordinatorState"
---

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:16

Observable state for the request stream and latest successful response.

## Properties

### isProcessing

> **isProcessing**: `boolean`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:22

Set at each [RequestCoordinator.send](/reference/client/classes/requestcoordinator/#send) start and cleared when that call
settles. Callers must not overlap sends because this flag is not
reference-counted.

***

### lastResponse

> **lastResponse**: `MaelstromResponse` \| `null`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:24

Most recently completed successful response; failures retain the prior value.
