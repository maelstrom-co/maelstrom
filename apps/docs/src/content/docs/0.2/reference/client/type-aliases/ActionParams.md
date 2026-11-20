---
editUrl: false
next: false
prev: false
title: "ActionParams"
---

> **ActionParams**\<`V`, `Name`\> = `GetActionParams`\<`GetAllActions`\<`V`\>, `Name`\>

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:101

Typed parameter object for action `Name` on vessel `V`. Resolves to
`undefined` for parameterless actions.

## Type Parameters

### V

`V` *extends* `VesselDefinition`

### Name

`Name` *extends* [`ActionNames`](/reference/client/type-aliases/actionnames/)\<`V`\>
