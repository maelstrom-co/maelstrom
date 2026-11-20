---
editUrl: false
next: false
prev: false
title: "VesselVariantSchema"
---

> `const` **VesselVariantSchema**: `ZodObject`\<\{ `actions`: `ZodArray`\<`ZodObject`\<\{ `description`: `ZodString`; `idempotent`: `ZodDefault`\<`ZodOptional`\<`ZodBoolean`\>\>; `name`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `parameters`: `ZodOptional`\<`ZodArray`\<`ZodObject`\<\{ `defaultValue`: `ZodOptional`\<`ZodUnknown`\>; `description`: `ZodString`; `enum`: `ZodOptional`\<`ZodArray`\<...\>\>; `name`: `ZodString`; `required`: `ZodOptional`\<`ZodBoolean`\>; `type`: `ZodEnum`\<\{ `boolean`: ...; `number`: ...; `object`: ...; `string`: ...; \}\>; \}, `$strip`\>\>\>; `transitionsTo`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>\>; \}, `$strip`\>\>; `description`: `ZodOptional`\<`ZodString`\>; `minSize`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; `props`: `ZodRecord`\<`ZodString`, `ZodUnknown`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/vessel.ts:49

Validates local Variant shape; cross-Action invariants require [VesselSchema](/reference/protocol/variables/vesselschema/).
