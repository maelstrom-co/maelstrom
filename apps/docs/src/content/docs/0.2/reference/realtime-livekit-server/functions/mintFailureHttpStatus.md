---
editUrl: false
next: false
prev: false
title: "mintFailureHttpStatus"
---

> **mintFailureHttpStatus**(`reason`): `number`

Defined in: packages/realtime-protocol/dist/lib/mint.d.ts:58

Suggested HTTP status for a [MintFailureReason](/reference/realtime-livekit-server/type-aliases/mintfailurereason/), for callers wiring a
minter into an HTTP transport. Minters stay transport-agnostic — nothing
requires this mapping; a caller with different status-code conventions is
free to write its own.

## Parameters

### reason

`"invalid-request"` \| `"unsupported-provider"` \| `"missing-api-key"` \| `"invalid-config"` \| `"upstream-failure"`

## Returns

`number`

## Example

```ts
return Response.json(
  { error: result.error.reason },
  { status: mintFailureHttpStatus(result.error.reason) },
);
```
