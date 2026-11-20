---
editUrl: false
next: false
prev: false
title: "isOk"
---

> **isOk**\<`T`, `E`\>(`result`): `result is { ok: true; value: T }`

Defined in: packages/protocol/src/lib/result.ts:17

Checks only the `ok` discriminator and preserves the original branch object.

## Type Parameters

### T

`T`

### E

`E`

## Parameters

### result

[`Result`](/reference/protocol/type-aliases/result/)\<`T`, `E`\>

## Returns

`result is { ok: true; value: T }`
