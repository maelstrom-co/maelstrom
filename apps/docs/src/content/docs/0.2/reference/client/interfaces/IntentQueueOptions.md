---
editUrl: false
next: false
prev: false
title: "IntentQueueOptions"
---

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:10

Mount-time admission policy shared by every source of user intent.
Durations must be finite, positive and at most 2,147,483,647ms; invalid
configuration throws at construction. Pending users send only while connected.
Deadlines settle tickets without cancelling work or releasing an unresolved turn.

## Properties

### activeTimeoutMs?

> `readonly` `optional` **activeTimeoutMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:18

Active ticket deadline in milliseconds; default 60,000. Does not release an unresolved transport lock.

***

### capacity?

> `readonly` `optional` **capacity?**: `number`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:12

Maximum pending users, excluding the active turn. Positive safe integer; default 8.

***

### connectionGraceMs?

> `readonly` `optional` **connectionGraceMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:16

Pending connection-loss grace in milliseconds, capped by maxWaitMs; default 10,000.

***

### maxWaitMs?

> `readonly` `optional` **maxWaitMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:14

Maximum pending wait in milliseconds; default 30,000.
