---
editUrl: false
next: false
prev: false
title: "tilingLeafToken"
---

> **tilingLeafToken**(`instanceId`): `` `ID:${string}` ``

Defined in: packages/protocol/src/lib/response.ts:214

Renders an Instance as the leaf token a tiling tree carries.

## Parameters

### instanceId

[`InstanceId`](/reference/protocol/type-aliases/instanceid/)

## Returns

`` `ID:${string}` ``

## Example

```ts
// ['V', 'ID:calendar-main', 'ID:tasks-main']
['V', tilingLeafToken(calendarId), tilingLeafToken(tasksId)];
```
