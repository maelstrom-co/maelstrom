---
editUrl: false
next: false
prev: false
title: "withFallback"
---

> **withFallback**\<`In`, `Out`\>(`primary`, `fallback`): [`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

Defined in: packages/engine/src/lib/planner/with-fallback.ts:24

Runs `primary`, and runs `fallback` with the same input and context only
when `primary` returns a `Deferred`. Candidates and `EngineError`s from
`primary` are returned unchanged, so a real failure is never masked by a
second attempt.

The two run one after the other: on deferral the latencies add up. Both
stages share the request's signal and must honour it.

## Type Parameters

### In

`In`

### Out

`Out`

## Parameters

### primary

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

### fallback

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

## Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

## Example

```ts
// `modelPlanner` is any `Planner`, for example one that calls a model.
const planner = withFallback(
  pipeline(selectVessels, arrangeLayout),
  modelPlanner,
);
```
