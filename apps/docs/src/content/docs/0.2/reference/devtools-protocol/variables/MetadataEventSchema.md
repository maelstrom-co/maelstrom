---
editUrl: false
next: false
prev: false
title: "MetadataEventSchema"
---

> `const` **MetadataEventSchema**: `ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `at`: `ZodOptional`\<`ZodNumber`\>; `kind`: `ZodString`; `metadata`: `ZodRecord`\<`ZodString`, `ZodUnknown`\>; `requestId`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:159

An already-redacted observation without raw envelopes or captured content.
