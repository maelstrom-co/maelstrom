---
editUrl: false
next: false
prev: false
title: "UpdateReasonSchema"
---

> `const` **UpdateReasonSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `intent`: `ZodString`; `type`: `ZodLiteral`\<`"user_intent"`\>; \}, `$strip`\>, `ZodObject`\<\{ `current`: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>; `previous`: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>; `type`: `ZodLiteral`\<`"chart_resize"`\>; \}, `$strip`\>, `ZodObject`\<\{ `changes`: `ZodString`; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `type`: `ZodLiteral`\<`"vessel_mutation"`\>; \}, `$strip`\>\], `"type"`\>

Defined in: packages/protocol/src/lib/request.ts:103

Wire-format Zod parser for [UpdateReason](/reference/protocol/type-aliases/updatereason/), discriminated on
`type`. Used by [ChartRequestSchema](/reference/protocol/variables/chartrequestschema/) for `context.updateReasons`.
