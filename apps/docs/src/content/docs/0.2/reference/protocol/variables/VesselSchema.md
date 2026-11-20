---
editUrl: false
next: false
prev: false
title: "VesselSchema"
---

> `const` **VesselSchema**: `ZodObject`\<\{ `defaultVariant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>; `description`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VesselId`](/reference/protocol/type-aliases/vesselid/), `string`\>\>; `name`: `ZodString`; `variants`: `ZodRecord`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>, `ZodObject`\<\{ `actions`: `ZodArray`\<`ZodObject`\<\{ `description`: `ZodString`; `idempotent`: `ZodDefault`\<`ZodOptional`\<`ZodBoolean`\>\>; `name`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `parameters`: `ZodOptional`\<`ZodArray`\<`ZodObject`\<..., ...\>\>\>; `transitionsTo`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>\>; \}, `$strip`\>\>; `description`: `ZodOptional`\<`ZodString`\>; `minSize`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; `props`: `ZodRecord`\<`ZodString`, `ZodUnknown`\>; \}, `$strip`\>\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/vessel.ts:62

Parses and brands a complete Vessel definition.

Requires at least one Variant, a valid default Variant, unique Action and
parameter names within their scopes, and valid Action transition targets.
