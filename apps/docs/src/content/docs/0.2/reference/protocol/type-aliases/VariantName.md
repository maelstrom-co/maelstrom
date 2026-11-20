---
editUrl: false
next: false
prev: false
title: "VariantName"
---

> **VariantName** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"VariantName"`\>

Defined in: packages/protocol/src/lib/variant-name.ts:10

Opaque identifier for a variant within a vessel definition.

Variant names are unique within a single vessel but not globally — two
different vessels may both define a `"detail"` variant. The brand
captures shape, not cross-vessel uniqueness.
