---
editUrl: false
next: false
prev: false
title: "ReadResultSchema"
---

> `const` **ReadResultSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `data`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `apps`: `ZodArray`\<`ZodObject`\<\{ `active`: ...; `id`: ...; `identity`: ...; `reportedId`: ...; \}, `$strict`\>\>; `kind`: `ZodLiteral`\<`"apps"`\>; `omitted`: `ZodNumber`; \}, `$strict`\>, `ZodObject`\<\{ `cursor`: `ZodOptional`\<`ZodString`\>; `events`: `ZodArray`\<`ZodObject`\<\{ `appId`: ...; `at`: ...; `kind`: ...; `metadata`: ...; `requestId`: ...; \}, `$strict`\>\>; `hidden`: `ZodNumber`; `kind`: `ZodLiteral`\<`"events"`\>; `losses`: `ZodObject`\<\{ `connections`: `ZodNull`; `recent`: `ZodNumber`; `requests`: `ZodNumber`; `scope`: `ZodLiteral`\<...\>; \}, `$strict`\>; `matched`: `ZodNumber`; `observedAt`: `ZodNumber`; `remaining`: `ZodNumber`; `request`: `ZodOptional`\<`ZodObject`\<\{ `application`: ...; `outcome`: ...; `requestId`: ...; `roundTrip`: ...; \}, `$strict`\>\>; `total`: `ZodNumber`; `view`: `ZodDefault`\<`ZodEnum`\<\{ `connections`: ...; `recent`: ...; `requests`: ...; \}\>\>; `viewerOmitted`: `ZodNumber`; \}, `$strict`\>\], `"kind"`\>; `ok`: `ZodLiteral`\<`true`\>; \}, `$strict`\>, `ZodObject`\<\{ `error`: `ZodEnum`\<\{ `app_unavailable`: `"app_unavailable"`; `cancelled`: `"cancelled"`; `evidence_unavailable`: `"evidence_unavailable"`; `invalid_request`: `"invalid_request"`; `limit_exceeded`: `"limit_exceeded"`; `request_unavailable`: `"request_unavailable"`; `stale_cursor`: `"stale_cursor"`; `target_unavailable`: `"target_unavailable"`; `timeout`: `"timeout"`; \}\>; `ok`: `ZodLiteral`\<`false`\>; \}, `$strict`\>\], `"ok"`\>

Defined in: packages/devtools-protocol/src/index.ts:226

Typed result returned across the browser bridge and MCP.
