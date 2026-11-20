---
editUrl: false
next: false
prev: false
title: "ActionParameterSchema"
---

> `const` **ActionParameterSchema**: `ZodObject`\<\{ `defaultValue`: `ZodOptional`\<`ZodUnknown`\>; `description`: `ZodString`; `enum`: `ZodOptional`\<`ZodArray`\<`ZodUnknown`\>\>; `name`: `ZodString`; `required`: `ZodOptional`\<`ZodBoolean`\>; `type`: `ZodEnum`\<\{ `boolean`: `"boolean"`; `number`: `"number"`; `object`: `"object"`; `string`: `"string"`; \}\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/vessel.ts:17

Parses one Action parameter definition, including a bounded enum candidate list.
Parameter names are required but remain unbranded author-facing strings.
