---
editUrl: false
next: false
prev: false
title: "ChartRequestSchema"
---

> `const` **ChartRequestSchema**: `ZodObject`\<\{ `context`: `ZodObject`\<\{ `chartDimensions`: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>; `layoutMode`: `ZodEnum`\<\{ `grid`: `"grid"`; `tiling`: `"tiling"`; \}\>; `updateReasons`: `ZodArray`\<`ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `intent`: `ZodString`; `type`: `ZodLiteral`\<`"user_intent"`\>; \}, `$strip`\>, `ZodObject`\<\{ `current`: `ZodObject`\<\{ `columns`: ...; `rows`: ...; \}, `$strip`\>; `previous`: `ZodObject`\<\{ `columns`: ...; `rows`: ...; \}, `$strip`\>; `type`: `ZodLiteral`\<`"chart_resize"`\>; \}, `$strip`\>, `ZodObject`\<\{ `changes`: `ZodString`; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `type`: `ZodLiteral`\<`"vessel_mutation"`\>; \}, `$strip`\>\], `"type"`\>\>; \}, `$strip`\>; `instances`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `variant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>; `vesselId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VesselId`](/reference/protocol/type-aliases/vesselid/), `string`\>\>; \}, `$strip`\>\>; `intentFacts`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodType`\<`Mutable`\<[`JsonValue`](/reference/protocol/type-aliases/jsonvalue/)\>, `unknown`, `$ZodTypeInternals`\<`Mutable`\<[`JsonValue`](/reference/protocol/type-aliases/jsonvalue/)\>, `unknown`\>\>\>\>; `layout`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `positions`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `position`: `ZodObject`\<\{ `column`: ...; `row`: ...; \}, `$strip`\>; `size`: `ZodObject`\<\{ `height`: ...; `width`: ...; \}, `$strip`\>; \}, `$strip`\>\>; `type`: `ZodLiteral`\<`"grid"`\>; \}, `$strip`\>, `ZodObject`\<\{ `instances`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `variant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `vesselId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; \}, `$strip`\>\>; `tree`: `ZodArray`\<`ZodPipe`\<`ZodNullable`\<`ZodString`\>, `ZodTransform`\<`"H"` \| `"V"` \| `` `H:${(...)}` `` \| `` `V:${(...)}` `` \| `` `ID:${(...)}` `` \| `null`, `string` \| `null`\>\>\>; `type`: `ZodLiteral`\<`"tiling"`\>; \}, `$strip`\>\], `"type"`\>; `skipReply`: `ZodOptional`\<`ZodBoolean`\>; `type`: `ZodLiteral`\<`"chart_request"`\>; `vessels`: `ZodArray`\<`ZodObject`\<\{ `defaultVariant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>; `description`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`VesselId`](/reference/protocol/type-aliases/vesselid/), `string`\>\>; `name`: `ZodString`; `variants`: `ZodRecord`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`VariantName`](/reference/protocol/type-aliases/variantname/), `string`\>\>, `ZodObject`\<\{ `actions`: `ZodArray`\<`ZodObject`\<\{ `description`: ...; `idempotent`: ...; `name`: ...; `parameters`: ...; `transitionsTo`: ...; \}, `$strip`\>\>; `description`: `ZodOptional`\<`ZodString`\>; `minSize`: `ZodObject`\<\{ `height`: `ZodNumber`; `width`: `ZodNumber`; \}, `$strip`\>; `props`: `ZodRecord`\<`ZodString`, `ZodUnknown`\>; \}, `$strip`\>\>; \}, `$strip`\>\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:333

Wire-format Zod parser for [ChartRequest](/reference/protocol/interfaces/chartrequest/).

Validates payload shape via the inner schemas and enforces coherence across
`instances`, `vessels`, `layout`, and `context.layoutMode`. On a successful
parse the caller may rely on:

- `layout.type` agreeing with `context.layoutMode`
- every `instances[].vesselId` resolving to a registered vessel and every
  `instances[].variant` declared on that vessel (own-property only — no
  `Object.prototype` lookalikes)
- the same `vesselId`/`variant` coherence on tiling `layout.instances[]`,
  no duplicate `instanceId` within it, and the entry list as a *superset*
  of input `instances` (extras allowed for newly-introduced instances;
  missing entries rejected)
- no duplicate `vesselId` in `vessels`, no duplicate `instanceId` in
  `instances` or `layout.positions`
- tiling tree leaves all declared in `layout.instances`
- grid `layout.positions[].instanceId` resolving to an `instances[]` entry

Strict-fail (issues → parse failure) rather than lenient-skip: client input
is deterministic, so silent dropping would mutate caller state and hide the
same drift this validation is meant to surface.
