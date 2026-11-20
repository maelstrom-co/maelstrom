---
editUrl: false
next: false
prev: false
title: "CommandProcessorOptions"
---

Defined in: packages/client/src/lib/command-processor/command-processor.types.ts:4

Configuration for command queueing and Action execution.

## Properties

### actionExecutionTimeoutMs?

> `optional` **actionExecutionTimeoutMs?**: `number`

Defined in: packages/client/src/lib/command-processor/command-processor.types.ts:16

Maximum duration for one Action handler. Defaults to 30,000 milliseconds;
expiry records that Action as failed.

***

### debug?

> `optional` **debug?**: `boolean`

Defined in: packages/client/src/lib/command-processor/command-processor.types.ts:6

Enables diagnostic logging. Defaults to `false`.

***

### defaultActionWaitTimeoutMs?

> `optional` **defaultActionWaitTimeoutMs?**: `number`

Defined in: packages/client/src/lib/command-processor/command-processor.types.ts:11

Wait for a missing Action runner before skipping its Actions. Defaults to
500 milliseconds.

***

### initialState?

> `optional` **initialState?**: [`CommandProcessingState`](/reference/client/type-aliases/commandprocessingstate/)

Defined in: packages/client/src/lib/command-processor/command-processor.types.ts:18

Initial state override. Defaults to a fresh empty tiling state.
