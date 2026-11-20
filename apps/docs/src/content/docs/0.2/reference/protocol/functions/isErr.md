---
editUrl: false
next: false
prev: false
title: "isErr"
---

> **isErr**\<`T`, `E`\>(`result`): `result is { error: E; ok: false }`

Defined in: packages/protocol/src/lib/result.ts:24

Checks only the `ok` discriminator; unlike [unwrap](/reference/protocol/functions/unwrap/), it never throws.

## Type Parameters

### T

`T`

### E

`E`

## Parameters

### result

[`Result`](/reference/protocol/type-aliases/result/)\<`T`, `E`\>

## Returns

`result is { error: E; ok: false }`
