---
editUrl: false
next: false
prev: false
title: "CommandProcessingState"
---

> **CommandProcessingState** = `object`

Defined in: packages/client/src/lib/command-processor/command-processor.state.ts:14

Observable command state; failures preserve the last applied layout and Instances.

## Properties

### instances

> **instances**: `Map`\<`InstanceId`, [`VesselInstance`](/reference/client/interfaces/vesselinstance/)\>

Defined in: packages/client/src/lib/command-processor/command-processor.state.ts:18

Reconciled by `set_layout`; omitted Instances are removed.

***

### lastError

> **lastError**: `Error` \| `null`

Defined in: packages/client/src/lib/command-processor/command-processor.state.ts:29

Last thrown command error. Individual Action failures emit `action_error`;
this field clears when the next command starts. `waitForIdle()` is the
supported way to observe a failure after the fact; it does not read this
field.

***

### layout

> **layout**: `GridLayout` \| `TilingLayout` \| `null`

Defined in: packages/client/src/lib/command-processor/command-processor.state.ts:20

Last successfully applied layout; Action and failed layout commands leave it unchanged.

***

### layoutMode

> **layoutMode**: `LayoutMode`

Defined in: packages/client/src/lib/command-processor/command-processor.state.ts:22

Initial-state metadata that [CommandProcessor](/reference/client/classes/commandprocessor/) does not read or update.

***

### status

> **status**: [`CommandProcessingStatus`](/reference/client/type-aliases/commandprocessingstatus/)

Defined in: packages/client/src/lib/command-processor/command-processor.state.ts:16

Returns to `idle` after the queue drains, including after a command error.
