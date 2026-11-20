---
editUrl: false
next: false
prev: false
title: "validationError"
---

> **validationError**(`message`, `field?`, `cause?`): [`ValidationError`](/reference/engine/interfaces/validationerror/)

Defined in: packages/engine/src/lib/errors.ts:201

Creates a semantic validation failure.

Omitted `field` and `cause` properties remain absent rather than being set
to `undefined`, so key-presence checks and serialization stay meaningful.

## Parameters

### message

`string`

### field?

`string`

### cause?

`unknown`

## Returns

[`ValidationError`](/reference/engine/interfaces/validationerror/)
