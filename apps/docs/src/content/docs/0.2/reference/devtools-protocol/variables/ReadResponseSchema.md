---
editUrl: false
next: false
prev: false
title: "ReadResponseSchema"
---

> `const` **ReadResponseSchema**: `ZodObject`\<\{ `id`: `ZodUUID`; `result`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `data`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `apps`: `ZodArray`\<...\>; `kind`: `ZodLiteral`\<...\>; `omitted`: `ZodNumber`; \}, `$strict`\>, `ZodObject`\<\{ `cursor`: `ZodOptional`\<...\>; `events`: `ZodArray`\<...\>; `hidden`: `ZodNumber`; `kind`: `ZodLiteral`\<...\>; `losses`: `ZodObject`\<..., ...\>; `matched`: `ZodNumber`; `observedAt`: `ZodNumber`; `remaining`: `ZodNumber`; `request`: `ZodOptional`\<...\>; `total`: `ZodNumber`; `view`: `ZodDefault`\<...\>; `viewerOmitted`: `ZodNumber`; \}, `$strict`\>\], `"kind"`\>; `ok`: `ZodLiteral`\<`true`\>; \}, `$strict`\>, `ZodObject`\<\{ `error`: `ZodEnum`\<\{ `app_unavailable`: `"app_unavailable"`; `cancelled`: `"cancelled"`; `evidence_unavailable`: `"evidence_unavailable"`; `invalid_request`: `"invalid_request"`; `limit_exceeded`: `"limit_exceeded"`; `request_unavailable`: `"request_unavailable"`; `stale_cursor`: `"stale_cursor"`; `target_unavailable`: `"target_unavailable"`; `timeout`: `"timeout"`; \}\>; `ok`: `ZodLiteral`\<`false`\>; \}, `$strict`\>\], `"ok"`\>; `type`: `ZodLiteral`\<`"result"`\>; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:234

Result envelope correlated to one pending read.
