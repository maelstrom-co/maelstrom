---
editUrl: false
next: false
prev: false
title: "EventsSchema"
---

> `const` **EventsSchema**: `ZodObject`\<\{ `cursor`: `ZodOptional`\<`ZodString`\>; `events`: `ZodArray`\<`ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `at`: `ZodOptional`\<`ZodNumber`\>; `kind`: `ZodString`; `metadata`: `ZodRecord`\<`ZodString`, `ZodUnknown`\>; `requestId`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>\>; `hidden`: `ZodNumber`; `kind`: `ZodLiteral`\<`"events"`\>; `losses`: `ZodObject`\<\{ `connections`: `ZodNull`; `recent`: `ZodNumber`; `requests`: `ZodNumber`; `scope`: `ZodLiteral`\<`"all_apps"`\>; \}, `$strict`\>; `matched`: `ZodNumber`; `observedAt`: `ZodNumber`; `remaining`: `ZodNumber`; `request`: `ZodOptional`\<`ZodObject`\<\{ `application`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `durationMs`: `ZodNumber`; `kind`: `ZodLiteral`\<`"reported"`\>; \}, `$strict`\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"unreported"`\>; `reason`: `ZodEnum`\<\{ `ambiguous`: ...; `missing`: ...; `push`: ...; `redacted`: ...; `source-unavailable`: ...; `truncated`: ...; `unreadable`: ...; \}\>; \}, `$strict`\>\], `"kind"`\>; `outcome`: `ZodEnum`\<\{ `abandoned`: `"abandoned"`; `ambiguous`: `"ambiguous"`; `applied`: `"applied"`; `applied-with-issues`: `"applied-with-issues"`; `awaiting`: `"awaiting"`; `cancelled`: `"cancelled"`; `discarded`: `"discarded"`; `failed`: `"failed"`; `received`: `"received"`; `unknown`: `"unknown"`; \}\>; `requestId`: `ZodString`; `roundTrip`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `durationMs`: `ZodNumber`; `kind`: `ZodLiteral`\<`"reported"`\>; \}, `$strict`\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"unreported"`\>; `reason`: `ZodEnum`\<\{ `ambiguous`: ...; `missing`: ...; `push`: ...; `redacted`: ...; `source-unavailable`: ...; `truncated`: ...; `unreadable`: ...; \}\>; \}, `$strict`\>\], `"kind"`\>; \}, `$strict`\>\>; `total`: `ZodNumber`; `view`: `ZodDefault`\<`ZodEnum`\<\{ `connections`: `"connections"`; `recent`: `"recent"`; `requests`: `"requests"`; \}\>\>; `viewerOmitted`: `ZodNumber`; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:204

Bounded event query with explicit source and loss scope.
