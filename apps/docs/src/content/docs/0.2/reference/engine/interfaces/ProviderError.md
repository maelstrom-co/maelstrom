---
editUrl: false
next: false
prev: false
title: "ProviderError"
---

Defined in: packages/engine/src/lib/errors.ts:23

Raised when the underlying LLM provider (TanStack AI adapter) fails — e.g.
network error, rate limit, or provider-side fault. The original thrown
value is preserved in `cause` for provider-specific inspection.

## Properties

### \_tag

> `readonly` **\_tag**: `"ProviderError"`

Defined in: packages/engine/src/lib/errors.ts:24

***

### cause

> `readonly` **cause**: `unknown`

Defined in: packages/engine/src/lib/errors.ts:26

***

### message

> `readonly` **message**: `string`

Defined in: packages/engine/src/lib/errors.ts:25

***

### stack?

> `readonly` `optional` **stack?**: `string`

Defined in: packages/engine/src/lib/errors.ts:27
