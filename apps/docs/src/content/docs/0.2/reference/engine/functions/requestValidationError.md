---
editUrl: false
next: false
prev: false
title: "requestValidationError"
---

> **requestValidationError**(`issues`): [`RequestValidationError`](/reference/engine/interfaces/requestvalidationerror/)

Defined in: packages/engine/src/lib/errors.ts:342

Classifies Zod request issues as envelope or payload validation failures.

Root issues and empty issue lists are envelope failures. Otherwise, any
issue on an envelope field wins regardless of issue order; remaining issues
are payload failures. Symbol path segments are stringified in the result.

## Parameters

### issues

readonly `$ZodIssue`[]

## Returns

[`RequestValidationError`](/reference/engine/interfaces/requestvalidationerror/)
