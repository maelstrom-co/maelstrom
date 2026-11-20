---
editUrl: false
next: false
prev: false
title: "JsonValue"
---

> **JsonValue** = `string` \| `number` \| `boolean` \| `null` \| readonly `JsonValue`[] \| \{\[`key`: `string`\]: `JsonValue`; \}

Defined in: packages/protocol/src/lib/json-value.ts:11

A value that survives `JSON.stringify` and `JSON.parse` unchanged: a
string, a finite number, a boolean, `null`, or an array or plain object of
such values. `undefined`, functions, symbols, bigints and non-finite
numbers are not JSON values.
