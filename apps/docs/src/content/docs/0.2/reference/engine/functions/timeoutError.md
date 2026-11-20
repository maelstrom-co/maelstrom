---
editUrl: false
next: false
prev: false
title: "timeoutError"
---

> **timeoutError**(`message`, `timeoutMs`): [`TimeoutError`](/reference/engine/interfaces/timeouterror/)

Defined in: packages/engine/src/lib/errors.ts:222

Creates a timeout failure for a non-negative finite duration.

## Parameters

### message

`string`

### timeoutMs

`number`

## Returns

[`TimeoutError`](/reference/engine/interfaces/timeouterror/)

## Throws

If `timeoutMs` is negative or non-finite.
