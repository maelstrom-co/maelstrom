---
editUrl: false
next: false
prev: false
title: "ReadCommandSchema"
---

> `const` **ReadCommandSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `operation`: `ZodLiteral`\<`"list_apps"`\>; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; \}, `$strict`\>, `ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `criteria`: `ZodDefault`\<`ZodObject`\<\{ `family`: `ZodOptional`\<`ZodEnum`\<\{ `actions`: `"actions"`; `client`: `"client"`; `engine`: `"engine"`; `other`: `"other"`; `voice`: `"voice"`; \}\>\>; `from`: `ZodOptional`\<`ZodNumber`\>; `issueCategory`: `ZodOptional`\<`ZodEnum`\<\{ `all`: `"all"`; `application`: `"application"`; `provider`: `"provider"`; `readiness`: `"readiness"`; `timeout`: `"timeout"`; `transport`: `"transport"`; `unknown`: `"unknown"`; `unreported`: `"unreported"`; `validation`: `"validation"`; \}\>\>; `kind`: `ZodOptional`\<`ZodString`\>; `outcome`: `ZodOptional`\<`ZodEnum`\<\{ `abandoned`: `"abandoned"`; `cancelled`: `"cancelled"`; `discarded`: `"discarded"`; `failed`: `"failed"`; `skipped`: `"skipped"`; `started`: `"started"`; `succeeded`: `"succeeded"`; `succeeded_with_issues`: `"succeeded_with_issues"`; `unknown`: `"unknown"`; `unreported`: `"unreported"`; \}\>\>; `query`: `ZodOptional`\<`ZodString`\>; `requestKey`: `ZodOptional`\<`ZodString`\>; `until`: `ZodOptional`\<`ZodNumber`\>; `voiceKey`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>\>; `cursor`: `ZodOptional`\<`ZodString`\>; `limit`: `ZodDefault`\<`ZodNumber`\>; `operation`: `ZodLiteral`\<`"query_events"`\>; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; `view`: `ZodDefault`\<`ZodEnum`\<\{ `connections`: `"connections"`; `recent`: `"recent"`; `requests`: `"requests"`; \}\>\>; \}, `$strict`\>, `ZodObject`\<\{ `appId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsAppId"`, `"out"`\>; `cursor`: `ZodOptional`\<`ZodString`\>; `limit`: `ZodDefault`\<`ZodNumber`\>; `operation`: `ZodLiteral`\<`"get_request"`\>; `requestId`: `ZodString`; `targetId`: `$ZodBranded`\<`ZodUUID`, `"DevtoolsTargetId"`, `"out"`\>; \}, `$strict`\>\], `"operation"`\>

Defined in: packages/devtools-protocol/src/index.ts:120

Read operations accepted by the browser bridge.
