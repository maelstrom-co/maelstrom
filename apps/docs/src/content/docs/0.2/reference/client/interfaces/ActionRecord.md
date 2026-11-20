---
editUrl: false
next: false
prev: false
title: "ActionRecord"
---

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:177

Action execution summary.

## Properties

### action

> **action**: `ActionName`

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:179

***

### duration

> **duration**: `number`

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:181

***

### errorCategory?

> `optional` **errorCategory?**: `"transport"` \| `"validation"` \| `"timeout"` \| `"readiness"` \| `"application"` \| `"provider"` \| `"unknown"`

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:184

Producer-known cause of skipped or failed work; omitted when unavailable.

***

### instanceId

> **instanceId**: `InstanceId`

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:178

***

### result

> **result**: [`ActionResult`](/reference/client/type-aliases/actionresult/)

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:180

***

### skipped?

> `optional` **skipped?**: `boolean`

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:182
