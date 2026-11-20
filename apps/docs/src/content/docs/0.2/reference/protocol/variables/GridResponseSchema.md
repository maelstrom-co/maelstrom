---
editUrl: false
next: false
prev: false
title: "GridResponseSchema"
---

> `const` **GridResponseSchema**: `ZodObject`\<\{ `executionPlan`: `ZodArray`\<`ZodObject`\<\{ `action`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `paramsJson`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>\>; `layout`: `ZodObject`\<\{ `positions`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `position`: `ZodObject`\<\{ `column`: `ZodNumber`; `row`: `ZodNumber`; \}, `$strip`\>; `size`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; \}, `$strip`\>\>; \}, `$strip`\>; `rationale`: `ZodString`; `userMessage`: `ZodString`; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:174

Structured-output schema for a grid-mode LLM response.

Limits the execution plan but leaves semantic layout validation to the
Engine's heal layer.
