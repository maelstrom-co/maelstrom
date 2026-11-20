---
editUrl: false
next: false
prev: false
title: "DiagnosticSanitizerOptions"
---

Defined in: packages/protocol/src/lib/sanitize-diagnostics.ts:2

Bounds and policy for a serializable diagnostic projection.

## Properties

### maxCharacters?

> `readonly` `optional` **maxCharacters?**: `number`

Defined in: packages/protocol/src/lib/sanitize-diagnostics.ts:4

Maximum characters visited in one projection. Defaults to 2000000.

***

### maxStringCharacters?

> `readonly` `optional` **maxStringCharacters?**: `number`

Defined in: packages/protocol/src/lib/sanitize-diagnostics.ts:6

Maximum retained characters per string. Defaults to 16384.

***

### redact?

> `readonly` `optional` **redact?**: (`value`) => `unknown`

Defined in: packages/protocol/src/lib/sanitize-diagnostics.ts:10

Application policy receives a detached copy; its result is sanitized again.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### secrets?

> `readonly` `optional` **secrets?**: readonly `string`[]

Defined in: packages/protocol/src/lib/sanitize-diagnostics.ts:8

Additional exact credentials to remove. Never retained by the result.
