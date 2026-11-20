---
editUrl: false
next: false
prev: false
title: "ParseError"
---

Defined in: packages/engine/src/lib/errors.ts:11

Raised when the LLM's raw textual output cannot be parsed — typically a
missing required field or malformed JSON before schema validation runs.

Callers pattern-match on `_tag`. `raw` preserves the original string so
downstream diagnostics can log or surface the unparseable payload.

## Properties

### \_tag

> `readonly` **\_tag**: `"ParseError"`

Defined in: packages/engine/src/lib/errors.ts:12

***

### message

> `readonly` **message**: `string`

Defined in: packages/engine/src/lib/errors.ts:13

***

### raw

> `readonly` **raw**: `string`

Defined in: packages/engine/src/lib/errors.ts:14

***

### stack?

> `readonly` `optional` **stack?**: `string`

Defined in: packages/engine/src/lib/errors.ts:15
