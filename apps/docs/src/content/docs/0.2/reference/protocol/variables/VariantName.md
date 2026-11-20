---
editUrl: false
next: false
prev: false
title: "VariantName"
---

> **VariantName**: (`value`) => [`VariantName`](/reference/protocol/type-aliases/variantname/)

Defined in: packages/protocol/src/lib/variant-name.ts:10

Brands a string as a VariantName without changing its value.

Originates from `Vessel.variants` keys, `VesselAction.transitionsTo`, and
LLM output that references a variant.

## Parameters

### value

`string`

## Returns

[`VariantName`](/reference/protocol/type-aliases/variantname/)

## Example

```ts
const variant = VariantName('detail');
```
