---
editUrl: false
next: false
prev: false
title: "RequestSummarySchema"
---

> `const` **RequestSummarySchema**: `ZodObject`\<\{ `application`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `durationMs`: `ZodNumber`; `kind`: `ZodLiteral`\<`"reported"`\>; \}, `$strict`\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"unreported"`\>; `reason`: `ZodEnum`\<\{ `ambiguous`: `"ambiguous"`; `missing`: `"missing"`; `push`: `"push"`; `redacted`: `"redacted"`; `source-unavailable`: `"source-unavailable"`; `truncated`: `"truncated"`; `unreadable`: `"unreadable"`; \}\>; \}, `$strict`\>\], `"kind"`\>; `outcome`: `ZodEnum`\<\{ `abandoned`: `"abandoned"`; `ambiguous`: `"ambiguous"`; `applied`: `"applied"`; `applied-with-issues`: `"applied-with-issues"`; `awaiting`: `"awaiting"`; `cancelled`: `"cancelled"`; `discarded`: `"discarded"`; `failed`: `"failed"`; `received`: `"received"`; `unknown`: `"unknown"`; \}\>; `requestId`: `ZodString`; `roundTrip`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `durationMs`: `ZodNumber`; `kind`: `ZodLiteral`\<`"reported"`\>; \}, `$strict`\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"unreported"`\>; `reason`: `ZodEnum`\<\{ `ambiguous`: `"ambiguous"`; `missing`: `"missing"`; `push`: `"push"`; `redacted`: `"redacted"`; `source-unavailable`: `"source-unavailable"`; `truncated`: `"truncated"`; `unreadable`: `"unreadable"`; \}\>; \}, `$strict`\>\], `"kind"`\>; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:186

Shared DevTools request interpretation with independent producer clocks.
