---
editUrl: false
next: false
prev: false
title: "ReadRequestSchema"
---

> `const` **ReadRequestSchema**: `ZodObject`\<\{ `command`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `operation`: `ZodLiteral`\<`"list_apps"`\>; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; \}, `$strict`\>, `ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `criteria`: `ZodDefault`\<`ZodObject`\<\{ `family`: `ZodOptional`\<`ZodEnum`\<...\>\>; `from`: `ZodOptional`\<`ZodNumber`\>; `issueCategory`: `ZodOptional`\<`ZodEnum`\<...\>\>; `kind`: `ZodOptional`\<`ZodString`\>; `outcome`: `ZodOptional`\<`ZodEnum`\<...\>\>; `query`: `ZodOptional`\<`ZodString`\>; `requestKey`: `ZodOptional`\<`ZodString`\>; `until`: `ZodOptional`\<`ZodNumber`\>; `voiceKey`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>\>; `cursor`: `ZodOptional`\<`ZodString`\>; `limit`: `ZodDefault`\<`ZodNumber`\>; `operation`: `ZodLiteral`\<`"query_events"`\>; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; `view`: `ZodDefault`\<`ZodEnum`\<\{ `connections`: `"connections"`; `recent`: `"recent"`; `requests`: `"requests"`; \}\>\>; \}, `$strict`\>, `ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `cursor`: `ZodOptional`\<`ZodString`\>; `limit`: `ZodDefault`\<`ZodNumber`\>; `operation`: `ZodLiteral`\<`"get_request"`\>; `requestId`: `ZodString`; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; \}, `$strict`\>\], `"operation"`\>; `id`: `ZodUUID`; `type`: `ZodLiteral`\<`"read"`\>; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:126

Correlated read request from the authenticated local process.
