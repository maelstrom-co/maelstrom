---
editUrl: false
next: false
prev: false
title: "DiagnosticEventSchema"
---

> `const` **DiagnosticEventSchema**: `ZodObject`\<\{ `at`: `ZodNumber`; `content`: `ZodOptional`\<`ZodUnknown`\>; `id`: `ZodString`; `kind`: `ZodString`; `metadata`: `ZodRecord`\<`ZodString`, `ZodUnion`\<readonly \[`ZodString`, `ZodNumber`, `ZodBoolean`, `ZodNull`\]\>\>; `requestId`: `ZodOptional`\<`ZodString`\>; `runId`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>\>; `sessionId`: `ZodString`; \}, `$strip`\>

Defined in: packages/protocol/src/lib/diagnostics.ts:32

Validates diagnostic frames without accepting executable content.
