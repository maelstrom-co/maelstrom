---
editUrl: false
next: false
prev: false
title: "ActionName"
---

> **ActionName**: (`value`) => [`ActionName`](/reference/protocol/type-aliases/actionname/)

Defined in: packages/protocol/src/lib/action-name.ts:9

Brands a string as an ActionName without changing its value.

Originates from `VesselAction.name` and LLM-output execution-plan items.

## Parameters

### value

`string`

## Returns

[`ActionName`](/reference/protocol/type-aliases/actionname/)

## Example

```ts
const action = ActionName('selectOrder');
```
