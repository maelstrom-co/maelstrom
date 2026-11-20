---
editUrl: false
next: false
prev: false
title: "VesselActionSchema"
---

> `const` **VesselActionSchema**: `ZodObject`\<\{ `description`: `ZodString`; `idempotent`: `ZodDefault`\<`ZodOptional`\<`ZodBoolean`\>\>; `name`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `parameters`: `ZodOptional`\<`ZodArray`\<`ZodObject`\<\{ `defaultValue`: `ZodOptional`\<`ZodUnknown`\>; `description`: `ZodString`; `enum`: `ZodOptional`\<`ZodArray`\<`ZodUnknown`\>\>; `name`: `ZodString`; `required`: `ZodOptional`\<`ZodBoolean`\>; `type`: `ZodEnum`\<\{ `boolean`: `"boolean"`; `number`: `"number"`; `object`: `"object"`; `string`: `"string"`; \}\>; \}, `$strip`\>\>\>; `transitionsTo`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/vessel.ts:36

Brands an Action and defers transition-target existence to [VesselSchema](/reference/protocol/variables/vesselschema/).

`idempotent` parses to an explicit boolean so consumers never branch on
`undefined`; see [VesselActionDefinition.idempotent](/reference/protocol/interfaces/vesselactiondefinition/#idempotent) for what the flag
promises.
