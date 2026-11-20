---
editUrl: false
next: false
prev: false
title: "ActionExecutionSchema"
---

> `const` **ActionExecutionSchema**: `ZodObject`\<\{ `action`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `paramsJson`: `ZodOptional`\<`ZodString`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/schemas.ts:63

Parses model-authored Action execution output.

IDs and Action names are branded. Optional parameters remain byte-bounded;
JSON syntax and semantic parameters are validated later by the Engine.
