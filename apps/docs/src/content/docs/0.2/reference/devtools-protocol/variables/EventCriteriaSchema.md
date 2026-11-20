---
editUrl: false
next: false
prev: false
title: "EventCriteriaSchema"
---

> `const` **EventCriteriaSchema**: `ZodObject`\<\{ `family`: `ZodOptional`\<`ZodEnum`\<\{ `actions`: `"actions"`; `client`: `"client"`; `engine`: `"engine"`; `other`: `"other"`; `voice`: `"voice"`; \}\>\>; `from`: `ZodOptional`\<`ZodNumber`\>; `issueCategory`: `ZodOptional`\<`ZodEnum`\<\{ `all`: `"all"`; `application`: `"application"`; `provider`: `"provider"`; `readiness`: `"readiness"`; `timeout`: `"timeout"`; `transport`: `"transport"`; `unknown`: `"unknown"`; `unreported`: `"unreported"`; `validation`: `"validation"`; \}\>\>; `kind`: `ZodOptional`\<`ZodString`\>; `outcome`: `ZodOptional`\<`ZodEnum`\<\{ `abandoned`: `"abandoned"`; `cancelled`: `"cancelled"`; `discarded`: `"discarded"`; `failed`: `"failed"`; `skipped`: `"skipped"`; `started`: `"started"`; `succeeded`: `"succeeded"`; `succeeded_with_issues`: `"succeeded_with_issues"`; `unknown`: `"unknown"`; `unreported`: `"unreported"`; \}\>\>; `query`: `ZodOptional`\<`ZodString`\>; `requestKey`: `ZodOptional`\<`ZodString`\>; `until`: `ZodOptional`\<`ZodNumber`\>; `voiceKey`: `ZodOptional`\<`ZodString`\>; \}, `$strict`\>

Defined in: packages/devtools-protocol/src/index.ts:48

Editable criteria shared with the DevTools event-query semantics.
