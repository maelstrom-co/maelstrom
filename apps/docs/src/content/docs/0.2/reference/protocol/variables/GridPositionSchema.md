---
editUrl: false
next: false
prev: false
title: "GridPositionSchema"
---

> `const` **GridPositionSchema**: `ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `position`: `ZodObject`\<\{ `column`: `ZodNumber`; `row`: `ZodNumber`; \}, `$strip`\>; `size`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/schemas.ts:88

Parses and brands one grid-mode Instance allocation.
