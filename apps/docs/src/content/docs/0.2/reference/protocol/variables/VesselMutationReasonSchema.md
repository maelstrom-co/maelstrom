---
editUrl: false
next: false
prev: false
title: "VesselMutationReasonSchema"
---

> `const` **VesselMutationReasonSchema**: `ZodObject`\<\{ `changes`: `ZodString`; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `type`: `ZodLiteral`\<`"vessel_mutation"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:93

Wire-format Zod parser for [VesselMutationReason](/reference/protocol/interfaces/vesselmutationreason/). `instanceId`
is branded through [InstanceIdSchema](/reference/protocol/variables/instanceidschema/) so the inferred shape matches
the hand-written interface end-to-end.
