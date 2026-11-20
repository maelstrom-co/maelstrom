---
editUrl: false
next: false
prev: false
title: "CancellationError"
---

Defined in: packages/engine/src/lib/errors.ts:76

Raised when an operation is cancelled via an `AbortSignal` (either
pre-aborted or aborted mid-flight). `reason` preserves the caller-supplied
abort reason (matches the Web `AbortSignal.reason` contract).

## Properties

### \_tag

> `readonly` **\_tag**: `"CancellationError"`

Defined in: packages/engine/src/lib/errors.ts:77

***

### message

> `readonly` **message**: `string`

Defined in: packages/engine/src/lib/errors.ts:78

***

### reason

> `readonly` **reason**: `unknown`

Defined in: packages/engine/src/lib/errors.ts:79

***

### stack?

> `readonly` `optional` **stack?**: `string`

Defined in: packages/engine/src/lib/errors.ts:80
