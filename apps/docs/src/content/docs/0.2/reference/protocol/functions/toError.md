---
editUrl: false
next: false
prev: false
title: "toError"
---

> **toError**(`value`): `Error`

Defined in: packages/protocol/src/lib/to-error.ts:20

Coerce an unknown thrown value into an `Error` instance.

`try { ... } catch (e) { ... }` typically yields `e: unknown`. Most error-
handling sites need an `Error` instance to attach as `cause`, log a
stack, or propagate through APIs that require `Error`. This helper
preserves the original `Error` if one was thrown, and otherwise wraps
the stringified value in a new `Error` so the call site never has to
branch.

## Parameters

### value

`unknown`

## Returns

`Error`

## Example

```typescript
try {
  await risky();
} catch (err) {
  logger.error('risky failed', toError(err));
}
```
