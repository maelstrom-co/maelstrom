---
editUrl: false
next: false
prev: false
title: "IntentSchedulerState"
---

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:88

Admission authority, distinct from RequestCoordinator's network-only telemetry.

## Properties

### capacity

> `readonly` **capacity**: `number`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:94

Maximum pending users, excluding the active turn.

***

### currentTicketId

> `readonly` **currentTicketId**: `string` \| `null`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:96

Active queued ticket, or null for immediate/automatic work.

***

### pendingCount

> `readonly` **pendingCount**: `number`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:92

Number of accepted users waiting for dispatch.

***

### phase

> `readonly` **phase**: `"idle"` \| `"sending"` \| `"applying"`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:90

Applying includes settlement of the current atomic response batch.
