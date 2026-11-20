---
editUrl: false
next: false
prev: false
title: "GridResponseWithoutReplySchema"
---

> `const` **GridResponseWithoutReplySchema**: `ZodObject`\<\{ `executionPlan`: `ZodArray`\<`ZodObject`\<\{ `action`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `paramsJson`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>\>; `layout`: `ZodObject`\<\{ `positions`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `position`: `ZodObject`\<\{ `column`: `ZodNumber`; `row`: `ZodNumber`; \}, `$strip`\>; `size`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; \}, `$strip`\>\>; \}, `$strip`\>; `rationale`: `ZodString`; `userMessage`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:242

[GridResponseSchema](/reference/protocol/variables/gridresponseschema/) with an optional `userMessage`, for a request
that set [ChartRequest.skipReply](/reference/protocol/interfaces/chartrequest/#skipreply). Every other field keeps the strict
schema's rules.
