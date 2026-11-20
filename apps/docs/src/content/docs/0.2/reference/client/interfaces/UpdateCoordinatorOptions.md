---
editUrl: false
next: false
prev: false
title: "UpdateCoordinatorOptions"
---

Defined in: packages/client/src/lib/update-coordination/update-coordinator.types.ts:2

Timing and logging options for coalescing non-intent Chart updates.

## Properties

### debounceDelayMs?

> `optional` **debounceDelayMs?**: `number`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.types.ts:4

Quiet period before scheduled updates flush. Defaults to 300 milliseconds.

***

### debug?

> `optional` **debug?**: `boolean`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.types.ts:8

Enables diagnostic logging. Defaults to `false`.

***

### maxWaitMs?

> `optional` **maxWaitMs?**: `number`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.types.ts:6

Maximum age before a pending update flushes. Defaults to 1,000 milliseconds.
