---
editUrl: false
next: false
prev: false
title: "named"
---

> **named**\<`In`, `Out`\>(`name`, `stage`): [`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

Defined in: packages/engine/src/lib/planner/instrument.ts:76

Names `stage` for [Instrument.stage](/reference/engine/interfaces/instrument/#stage) and returns the same function.
No wrapper is created, so naming a stage never changes what it does. A
stage named twice keeps the last name.

## Type Parameters

### In

`In`

### Out

`Out`

## Parameters

### name

`string`

### stage

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

## Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

## Example

```ts
const planner = pipeline(named('select', select), named('layout', layout));
```
