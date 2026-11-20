---
editUrl: false
next: false
prev: false
title: "TimingEvidenceSchema"
---

> `const` **TimingEvidenceSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `durationMs`: `ZodNumber`; `kind`: `ZodLiteral`\<`"reported"`\>; \}, `$strict`\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"unreported"`\>; `reason`: `ZodEnum`\<\{ `ambiguous`: `"ambiguous"`; `missing`: `"missing"`; `push`: `"push"`; `redacted`: `"redacted"`; `source-unavailable`: `"source-unavailable"`; `truncated`: `"truncated"`; `unreadable`: `"unreadable"`; \}\>; \}, `$strict`\>\], `"kind"`\>

Defined in: packages/devtools-protocol/src/index.ts:167

Reported producer duration or the explicit reason it is unavailable.
