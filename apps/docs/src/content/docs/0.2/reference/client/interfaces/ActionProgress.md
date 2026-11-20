---
editUrl: false
next: false
prev: false
title: "ActionProgress"
---

Defined in: packages/client/src/lib/command-processor/action-manager.ts:23

One readiness or execution stage observed without changing Action behavior.

## Properties

### action?

> `readonly` `optional` **action?**: `ActionName`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:25

Action name when a specific handler starts.

***

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:31

Local elapsed duration for readiness.

***

### instanceId

> `readonly` **instanceId**: `InstanceId`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:24

Target Instance.

***

### phase

> `readonly` **phase**: `"waiting"` \| `"ready"` \| `"unavailable"` \| `"started"`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:26

Readiness and execution are distinct stages.
