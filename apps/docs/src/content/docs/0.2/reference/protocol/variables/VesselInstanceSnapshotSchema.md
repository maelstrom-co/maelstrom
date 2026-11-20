---
editUrl: false
next: false
prev: false
title: "VesselInstanceSnapshotSchema"
---

> `const` **VesselInstanceSnapshotSchema**: `ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `variant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>; `vesselId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VesselId`](/reference/protocol/type-aliases/vesselid/), `string`\>\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/schemas.ts:168

Parses and brands an Instance identity, Vessel identity, and current Variant.
