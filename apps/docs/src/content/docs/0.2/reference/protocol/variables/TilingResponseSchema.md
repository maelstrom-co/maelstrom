---
editUrl: false
next: false
prev: false
title: "TilingResponseSchema"
---

> `const` **TilingResponseSchema**: `ZodObject`\<\{ `executionPlan`: `ZodArray`\<`ZodObject`\<\{ `action`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `paramsJson`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>\>; `layout`: `ZodObject`\<\{ `instances`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `variant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>; `vesselId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VesselId`](/reference/protocol/type-aliases/vesselid/), `string`\>\>; \}, `$strip`\>\>; `tree`: `ZodArray`\<`ZodPipe`\<`ZodNullable`\<`ZodString`\>, `ZodTransform`\<`"H"` \| `"V"` \| `` `H:${string}` `` \| `` `V:${string}` `` \| `` `ID:${string}` `` \| `null`, `string` \| `null`\>\>\>; \}, `$strip`\>; `rationale`: `ZodString`; `userMessage`: `ZodString`; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:205

Structured-output schema for a tiling-mode LLM response.

Limits the execution plan but leaves tree and Instance coherence checks to
the Engine's heal layer.
