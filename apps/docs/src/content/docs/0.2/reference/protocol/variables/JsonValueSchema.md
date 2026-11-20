---
editUrl: false
next: false
prev: false
title: "JsonValueSchema"
---

> `const` **JsonValueSchema**: `z.ZodType`\<`Mutable`\<[`JsonValue`](/reference/protocol/type-aliases/jsonvalue/)\>\>

Defined in: packages/protocol/src/lib/json-value.ts:27

Wire-format Zod parser for [JsonValue](/reference/protocol/type-aliases/jsonvalue/). Rejects anything JSON cannot
carry, at any depth: an object property holding `undefined` or a function
fails the parse instead of being dropped on serialization.

The parsed value is a fresh, mutable copy that is assignable to
[JsonValue](/reference/protocol/type-aliases/jsonvalue/).
