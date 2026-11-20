---
editUrl: false
next: false
prev: false
title: "DiagnosticMessageSchema"
---

> `const` **DiagnosticMessageSchema**: `ZodObject`\<\{ `event`: `ZodObject`\<\{ `at`: `ZodNumber`; `content`: `ZodOptional`\<`ZodUnknown`\>; `id`: `ZodString`; `kind`: `ZodString`; `metadata`: `ZodRecord`\<`ZodString`, `ZodUnion`\<readonly \[`ZodString`, `ZodNumber`, `ZodBoolean`, `ZodNull`\]\>\>; `requestId`: `ZodOptional`\<`ZodString`\>; `runId`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>\>; `sessionId`: `ZodString`; \}, `$strip`\>; `type`: `ZodLiteral`\<`"engine.diagnostics.event"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/diagnostics.ts:68

Diagnostic event sent separately from normal Engine responses.
