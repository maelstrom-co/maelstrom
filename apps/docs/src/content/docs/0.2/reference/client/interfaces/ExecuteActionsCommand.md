---
editUrl: false
next: false
prev: false
title: "ExecuteActionsCommand"
---

Defined in: packages/client/src/lib/command-processor/command.types.ts:19

Executes different Instances concurrently and each Instance's Actions in order.

## Properties

### executionPlan

> **executionPlan**: readonly `ActionExecution`[]

Defined in: packages/client/src/lib/command-processor/command.types.ts:25

Plan order is preserved only among Actions targeting the same Instance.

***

### kind

> **kind**: `"execute_actions"`

Defined in: packages/client/src/lib/command-processor/command.types.ts:21

Dispatches to Action execution.

***

### requestId?

> `optional` **requestId?**: [`MessageId`](/reference/client/type-aliases/messageid/)

Defined in: packages/client/src/lib/command-processor/command.types.ts:23

Diagnostic correlation; never changes command execution.
