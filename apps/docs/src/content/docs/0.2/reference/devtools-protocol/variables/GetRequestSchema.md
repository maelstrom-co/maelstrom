---
editUrl: false
next: false
prev: false
title: "GetRequestSchema"
---

> `const` **GetRequestSchema**: `ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `cursor`: `ZodOptional`\<`ZodString`\>; `limit`: `ZodDefault`\<`ZodNumber`\>; `requestId`: `ZodString`; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:115

Input for a qualified request's retained metadata and reported timings.
