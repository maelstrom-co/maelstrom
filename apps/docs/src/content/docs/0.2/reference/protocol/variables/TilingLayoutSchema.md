---
editUrl: false
next: false
prev: false
title: "TilingLayoutSchema"
---

> `const` **TilingLayoutSchema**: `ZodObject`\<\{ `instances`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `variant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>; `vesselId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VesselId`](/reference/protocol/type-aliases/vesselid/), `string`\>\>; \}, `$strip`\>\>; `tree`: `ZodArray`\<`ZodPipe`\<`ZodNullable`\<`ZodString`\>, `ZodTransform`\<`"H"` \| `"V"` \| `` `H:${string}` `` \| `` `V:${string}` `` \| `` `ID:${string}` `` \| `null`, `string` \| `null`\>\>\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/schemas.ts:192

Parses the model-output tiling layout body.

Tree completeness, duplicate identities, and leaf-to-Instance coherence are
intentionally deferred to the Engine's heal layer.
