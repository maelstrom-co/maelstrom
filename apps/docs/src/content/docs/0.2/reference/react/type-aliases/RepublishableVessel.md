---
editUrl: false
next: false
prev: false
title: "RepublishableVessel"
---

> **RepublishableVessel**\<`V`\> = `VesselDefinition` & `object`

Defined in: packages/react/src/lib/vessel-entry-types.ts:126

A vessel definition safe to hand to `m.updateVessel()` or `handle.update()`
to republish `V`'s definition without remounting its component.

`props` is the crash surface: the rendered component and the hook that
feeds it read `props` straight off the store and hand it to the mounted
component, so a shape drift throws at render time instead of failing to
compile. `actions`, `enum` values, `description`, and `minSize` stay
free-form — pinning them too would break the documented republish use
case of rebuilding an action's `enum` from live data.

`variants` is a `Record<string, ...>`, not a per-key mapped type over
`VariantNames<V>`, because `Object.fromEntries` — the documented rebuild
idiom — returns a plain index-signature type with no named keys at all.
No object type with required named properties can ever accept that
return value, regardless of how loosely those properties are typed, so
the target has to be an index signature too. The cost: props are checked
against the union of every registered variant's props, not the specific
variant named at that key, so a value shaped like variant B's props
passes at variant A's key. What this still catches is the actual crash —
a shape that matches none of the vessel's registered variants.

## Type Declaration

### id

> **id**: `V`\[`"id"`\]

### variants

> **variants**: `Record`\<`string`, `VesselVariantDefinition` & `object`\>

## Type Parameters

### V

`V` *extends* `VesselDefinition`
