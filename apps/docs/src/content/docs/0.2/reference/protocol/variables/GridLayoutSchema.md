---
editUrl: false
next: false
prev: false
title: "GridLayoutSchema"
---

> `const` **GridLayoutSchema**: `ZodObject`\<\{ `positions`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `position`: `ZodObject`\<\{ `column`: `ZodNumber`; `row`: `ZodNumber`; \}, `$strip`\>; `size`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; \}, `$strip`\>\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/schemas.ts:106

Parses the model-output grid layout body.

The schema validates individual positions but allows overlap. Chart bounds,
uniqueness, and Variant minimum sizes are deferred to the heal layer.
