---
editUrl: false
next: false
prev: false
title: "VariantProps"
---

> **VariantProps**\<`V`\> = `{ [K in VariantNames<V>]: { variant: K } & V["variants"][K]["props"] }`\[[`VariantNames`](/reference/react/type-aliases/variantnames/)\<`V`\>\]

Defined in: packages/react/src/lib/vessel-entry-types.ts:34

Discriminated union of variant prop shapes for vessel `V`.

For each variant `K` in `V`, contributes a member
`{ variant: K } & V['variants'][K]['props']`. Components consume this
to render different content per variant while preserving literal-type
narrowing on the `variant` discriminant.

## Type Parameters

### V

`V` *extends* `VesselDefinition`

## Example

```typescript
function OrdersComponent({ variantProps }: { variantProps: VariantProps<typeof ordersVessel> }) {
  if (variantProps.variant === 'list') {
    // variantProps narrowed to the 'list' variant's props
  }
}
```
