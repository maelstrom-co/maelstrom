---
editUrl: false
next: false
prev: false
title: "recoverCorrelation"
---

> **recoverCorrelation**(`raw`): `object`

Defined in: packages/engine/src/lib/envelope-handler.ts:32

Best-effort correlation recovery for a frame that failed to decode.

A malformed frame has no typed envelope, but its raw JSON may still carry an
`id` / `sessionId` the client is awaiting. Extracting them lets the host
reject the pending promise instead of leaving the client to time out.
Blank (empty or whitespace-only) strings are skipped since they correlate
to nothing, and branding is defensively guarded so recovery can never
throw. Returns `{}` when nothing could be recovered.

## Parameters

### raw

`unknown`

## Returns

`object`

### requestId?

> `optional` **requestId?**: `MessageId`

### sessionId?

> `optional` **sessionId?**: `SessionId`
