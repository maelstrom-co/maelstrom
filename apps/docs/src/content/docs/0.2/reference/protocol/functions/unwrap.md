---
editUrl: false
next: false
prev: false
title: "unwrap"
---

> **unwrap**\<`T`, `E`\>(`result`): `T`

Defined in: packages/protocol/src/lib/result.ts:31

Extract the value from a Result, or throw the error. Non-Error values are wrapped in an Error with the original as `cause`. Use sparingly at system boundaries.

## Type Parameters

### T

`T`

### E

`E`

## Parameters

### result

[`Result`](/reference/protocol/type-aliases/result/)\<`T`, `E`\>

## Returns

`T`
